/**
 * tcp_server.cpp — epoll-based TCP Server Native Addon
 *
 * Architecture:
 *   - Creates a non-blocking TCP listen socket bound to a given port.
 *   - Uses epoll(7) in EDGE-TRIGGERED (EPOLLET) mode for O(1) per-event dispatch.
 *   - Runs the event loop on a dedicated std::thread so Node's JS event loop
 *     is never blocked, preserving full non-blocking I/O semantics end-to-end.
 *   - Data received from any peer is forwarded back to JavaScript via a
 *     Napi::ThreadSafeFunction (TSFN), which is the safe NAPI mechanism for
 *     cross-thread JS calls.
 *
 * Linux-only — guarded by #ifdef __linux__ at module registration level.
 *
 * Build: node-gyp build (see binding.gyp target "native_transport")
 */

#ifdef __linux__

#include <napi.h>

#include <sys/socket.h>
#include <sys/epoll.h>
#include <netinet/in.h>
#include <netinet/tcp.h>   // TCP_NODELAY
#include <arpa/inet.h>
#include <unistd.h>
#include <fcntl.h>
#include <errno.h>
#include <string.h>

#include <thread>
#include <atomic>
#include <mutex>
#include <unordered_map>
#include <string>
#include <vector>
#include <stdexcept>

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Make a file descriptor non-blocking. Returns 0 on success, -1 on error. */
static int make_nonblocking(int fd) {
    int flags = ::fcntl(fd, F_GETFL, 0);
    if (flags == -1) return -1;
    return ::fcntl(fd, F_SETFL, flags | O_NONBLOCK);
}

/** Disable Nagle's algorithm on a socket for minimum latency. */
static void set_tcp_nodelay(int fd) {
    int flag = 1;
    ::setsockopt(fd, IPPROTO_TCP, TCP_NODELAY,
                 reinterpret_cast<const char*>(&flag), sizeof(flag));
}

// ─────────────────────────────────────────────────────────────────────────────
// Data shuttled to JavaScript via TSFN
// ─────────────────────────────────────────────────────────────────────────────

struct InboundMessage {
    int    fd;           // source socket fd (acts as peer identifier)
    bool   is_connect;   // true → new connection event; false → data event
    bool   is_close;     // true → peer closed connection
    std::string payload; // raw bytes received (empty for connect/close)
};

// ─────────────────────────────────────────────────────────────────────────────
// TCPServer class
// ─────────────────────────────────────────────────────────────────────────────

class TCPServer {
public:
    // Maximum events the epoll_wait() batch can retrieve per iteration.
    // 64 is a reasonable batch size balancing memory and throughput.
    static constexpr int MAX_EVENTS = 64;

    TCPServer() : listen_fd_(-1), epoll_fd_(-1), running_(false) {}

    ~TCPServer() { Stop(); }

    // ── Start ────────────────────────────────────────────────────────────────

    /**
     * Start the TCP server on `port`.
     * `tsfn` is called on the JS thread for every inbound event.
     */
    void Start(int port, Napi::ThreadSafeFunction tsfn) {
        if (running_) return;

        tsfn_ = std::move(tsfn);
        port_ = port;

        // 1. Create the listening socket (SOCK_NONBLOCK avoids extra fcntl)
        listen_fd_ = ::socket(AF_INET, SOCK_STREAM | SOCK_NONBLOCK, 0);
        if (listen_fd_ < 0)
            throw std::runtime_error("socket() failed: " + std::string(strerror(errno)));

        // Allow fast server restart without waiting for TIME_WAIT
        int opt = 1;
        ::setsockopt(listen_fd_, SOL_SOCKET, SO_REUSEADDR, &opt, sizeof(opt));
        ::setsockopt(listen_fd_, SOL_SOCKET, SO_REUSEPORT, &opt, sizeof(opt));

        // 2. Bind
        struct sockaddr_in addr{};
        addr.sin_family = AF_INET;
        addr.sin_addr.s_addr = INADDR_ANY;
        addr.sin_port = htons(static_cast<uint16_t>(port));

        if (::bind(listen_fd_, reinterpret_cast<struct sockaddr*>(&addr), sizeof(addr)) < 0)
            throw std::runtime_error("bind() failed: " + std::string(strerror(errno)));

        // 3. Listen — backlog 512 matches typical production servers
        if (::listen(listen_fd_, 512) < 0)
            throw std::runtime_error("listen() failed: " + std::string(strerror(errno)));

        // 4. Create the epoll instance (EPOLL_CLOEXEC prevents fd leaks across fork)
        epoll_fd_ = ::epoll_create1(EPOLL_CLOEXEC);
        if (epoll_fd_ < 0)
            throw std::runtime_error("epoll_create1() failed: " + std::string(strerror(errno)));

        // 5. Register the listen fd with EPOLLET (edge-triggered)
        //    EPOLLIN | EPOLLET means: "notify me when NEW data/connections arrive,
        //    not on every subsequent read() call." This is what gives O(1) dispatch.
        struct epoll_event ev{};
        ev.events  = EPOLLIN | EPOLLET;
        ev.data.fd = listen_fd_;
        if (::epoll_ctl(epoll_fd_, EPOLL_CTL_ADD, listen_fd_, &ev) < 0)
            throw std::runtime_error("epoll_ctl(listen) failed: " + std::string(strerror(errno)));

        // 6. Kick off the event-loop thread
        running_ = true;
        loop_thread_ = std::thread(&TCPServer::EventLoop, this);
    }

    // ── Stop ─────────────────────────────────────────────────────────────────

    void Stop() {
        if (!running_) return;
        running_ = false;

        // Closing epoll_fd causes epoll_wait() to return EBADF → loop exits
        if (epoll_fd_ >= 0) { ::close(epoll_fd_); epoll_fd_ = -1; }
        if (listen_fd_ >= 0) { ::close(listen_fd_); listen_fd_ = -1; }

        if (loop_thread_.joinable()) loop_thread_.join();

        // Close all client sockets
        std::lock_guard<std::mutex> lock(clients_mu_);
        for (auto& [fd, _] : clients_) ::close(fd);
        clients_.clear();

        tsfn_.Release();
    }

    // ── Send to a specific peer ───────────────────────────────────────────────

    /**
     * Write `data` to peer socket `fd`.
     * Uses a retry loop to handle partial writes (EAGAIN on non-blocking socket).
     */
    bool Send(int fd, const std::string& data) {
        const char* buf = data.c_str();
        size_t remaining = data.size();
        while (remaining > 0) {
            ssize_t n = ::send(fd, buf, remaining, MSG_NOSIGNAL);
            if (n < 0) {
                if (errno == EAGAIN || errno == EWOULDBLOCK) {
                    // Buffer full — in a production system you'd queue and
                    // register EPOLLOUT to drain. For this demo we retry.
                    continue;
                }
                return false; // Hard error
            }
            buf += n;
            remaining -= static_cast<size_t>(n);
        }
        return true;
    }

private:
    // ── Internal event loop (runs on loop_thread_) ────────────────────────────

    /**
     * EventLoop: the hot path.
     *
     * epoll_wait() blocks until one or more fds become ready, then returns
     * a batch of events. Because we use EPOLLET, each event is fired exactly
     * once per edge transition, so we must drain each fd completely.
     * Complexity: O(k) where k = number of *ready* fds (not total fds).
     */
    void EventLoop() {
        struct epoll_event events[MAX_EVENTS];

        while (running_) {
            // Timeout of 200ms lets us check `running_` periodically
            int nfds = ::epoll_wait(epoll_fd_, events, MAX_EVENTS, 200);

            if (nfds < 0) {
                if (errno == EINTR) continue; // Signal interrupted — retry
                break;                        // epoll_fd_ closed → exit
            }

            for (int i = 0; i < nfds; ++i) {
                int fd = events[i].data.fd;

                if (fd == listen_fd_) {
                    // ── New connection(s) ──────────────────────────────────
                    // In EPOLLET mode we must accept() in a loop until EAGAIN
                    AcceptAll();
                } else {
                    // ── Data from existing peer ────────────────────────────
                    if (events[i].events & (EPOLLERR | EPOLLHUP)) {
                        RemovePeer(fd);
                    } else if (events[i].events & EPOLLIN) {
                        DrainRead(fd);
                    }
                }
            }
        }
    }

    // ── Accept loop (drains all pending connections on one edge) ──────────────

    void AcceptAll() {
        while (true) {
            struct sockaddr_in peer_addr{};
            socklen_t peer_len = sizeof(peer_addr);
            int client_fd = ::accept4(listen_fd_,
                                      reinterpret_cast<struct sockaddr*>(&peer_addr),
                                      &peer_len,
                                      SOCK_NONBLOCK | SOCK_CLOEXEC);
            if (client_fd < 0) {
                if (errno == EAGAIN || errno == EWOULDBLOCK) break; // Drained
                break; // Other error
            }

            set_tcp_nodelay(client_fd);

            // Register client_fd with epoll
            struct epoll_event ev{};
            ev.events  = EPOLLIN | EPOLLET | EPOLLRDHUP;
            ev.data.fd = client_fd;
            ::epoll_ctl(epoll_fd_, EPOLL_CTL_ADD, client_fd, &ev);

            // Track peer
            {
                std::lock_guard<std::mutex> lock(clients_mu_);
                clients_[client_fd] = true;
            }

            // Notify JS
            auto* msg = new InboundMessage{ client_fd, true, false, "" };
            tsfn_.NonBlockingCall(msg, JsCallback);
        }
    }

    // ── Read loop (drains all pending data on one edge) ───────────────────────

    void DrainRead(int fd) {
        std::string accumulated;
        char buf[4096];

        while (true) {
            ssize_t n = ::recv(fd, buf, sizeof(buf), 0);
            if (n > 0) {
                accumulated.append(buf, static_cast<size_t>(n));
            } else if (n == 0) {
                // EOF — peer closed the connection
                RemovePeer(fd);
                return;
            } else {
                if (errno == EAGAIN || errno == EWOULDBLOCK) break; // Drained
                RemovePeer(fd);
                return;
            }
        }

        if (!accumulated.empty()) {
            auto* msg = new InboundMessage{ fd, false, false, std::move(accumulated) };
            tsfn_.NonBlockingCall(msg, JsCallback);
        }
    }

    // ── Remove and close a peer ────────────────────────────────────────────────

    void RemovePeer(int fd) {
        ::epoll_ctl(epoll_fd_, EPOLL_CTL_DEL, fd, nullptr);
        ::close(fd);
        {
            std::lock_guard<std::mutex> lock(clients_mu_);
            clients_.erase(fd);
        }
        auto* msg = new InboundMessage{ fd, false, true, "" };
        tsfn_.NonBlockingCall(msg, JsCallback);
    }

    // ── TSFN callback — marshals C++ data back to the JS event loop ───────────

    static void JsCallback(Napi::Env env, Napi::Function js_cb,
                           InboundMessage* data) {
        if (env == nullptr || data == nullptr) { if (data) delete data; return; }

        Napi::Object obj = Napi::Object::New(env);
        obj.Set("fd",         Napi::Number::New(env, data->fd));
        obj.Set("isConnect",  Napi::Boolean::New(env, data->is_connect));
        obj.Set("isClose",    Napi::Boolean::New(env, data->is_close));
        obj.Set("payload",    Napi::String::New(env, data->payload));
        delete data;

        js_cb.Call({obj});
    }

    // ── Fields ────────────────────────────────────────────────────────────────

    int  listen_fd_;
    int  epoll_fd_;
    int  port_;
    std::atomic<bool>          running_;
    std::thread                loop_thread_;
    Napi::ThreadSafeFunction   tsfn_;
    std::mutex                 clients_mu_;
    std::unordered_map<int, bool> clients_; // fd → alive
};

// ─────────────────────────────────────────────────────────────────────────────
// NAPI wrapper — exposes TCPServer as a JS class
// ─────────────────────────────────────────────────────────────────────────────

class NativeTCPServer : public Napi::ObjectWrap<NativeTCPServer> {
public:
    static Napi::Object Init(Napi::Env env, Napi::Object exports) {
        Napi::Function func = DefineClass(env, "NativeTCPServer", {
            InstanceMethod<&NativeTCPServer::Start>("start"),
            InstanceMethod<&NativeTCPServer::Stop>("stop"),
            InstanceMethod<&NativeTCPServer::Send>("send"),
        });
        exports.Set("NativeTCPServer", func);
        return exports;
    }

    NativeTCPServer(const Napi::CallbackInfo& info)
        : Napi::ObjectWrap<NativeTCPServer>(info) {}

private:
    // start(port: number, callback: (event: object) => void)
    Napi::Value Start(const Napi::CallbackInfo& info) {
        Napi::Env env = info.Env();
        if (info.Length() < 2 || !info[0].IsNumber() || !info[1].IsFunction()) {
            Napi::TypeError::New(env, "start(port: number, cb: Function) expected")
                .ThrowAsJavaScriptException();
            return env.Undefined();
        }
        int port = info[0].As<Napi::Number>().Int32Value();
        Napi::Function cb = info[1].As<Napi::Function>();

        auto tsfn = Napi::ThreadSafeFunction::New(
            env, cb, "TCPServerTSFN", 0, 1);

        try {
            server_.Start(port, std::move(tsfn));
        } catch (const std::exception& ex) {
            Napi::Error::New(env, ex.what()).ThrowAsJavaScriptException();
        }
        return env.Undefined();
    }

    Napi::Value Stop(const Napi::CallbackInfo& info) {
        server_.Stop();
        return info.Env().Undefined();
    }

    // send(fd: number, data: string) → boolean
    Napi::Value Send(const Napi::CallbackInfo& info) {
        Napi::Env env = info.Env();
        if (info.Length() < 2 || !info[0].IsNumber() || !info[1].IsString()) {
            Napi::TypeError::New(env, "send(fd: number, data: string) expected")
                .ThrowAsJavaScriptException();
            return Napi::Boolean::New(env, false);
        }
        int fd = info[0].As<Napi::Number>().Int32Value();
        std::string data = info[1].As<Napi::String>().Utf8Value();
        return Napi::Boolean::New(env, server_.Send(fd, data));
    }

    TCPServer server_;
};

// ─────────────────────────────────────────────────────────────────────────────
// Module entry point
// ─────────────────────────────────────────────────────────────────────────────

Napi::Object InitTransport(Napi::Env env, Napi::Object exports) {
    NativeTCPServer::Init(env, exports);
    return exports;
}

#endif // __linux__
