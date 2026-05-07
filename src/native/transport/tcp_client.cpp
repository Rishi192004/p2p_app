/**
 * tcp_client.cpp — Non-blocking outbound TCP Client Native Addon
 *
 * Provides the outbound half of the native transport:
 *   - Connects to a remote peer's TCP server using a non-blocking socket.
 *   - Reads data with EAGAIN-aware drain loop (same as TCPServer's recv path).
 *   - Sends data with partial-write retry.
 *   - Forwards all events (connect, data, close, error) to JavaScript via TSFN.
 *
 * Linux-only — compiled only when OS == "linux" in binding.gyp.
 */

#ifdef __linux__

#include <napi.h>

#include <sys/socket.h>
#include <sys/epoll.h>
#include <netinet/in.h>
#include <netinet/tcp.h>
#include <arpa/inet.h>
#include <unistd.h>
#include <fcntl.h>
#include <errno.h>
#include <string.h>

#include <thread>
#include <atomic>
#include <string>
#include <stdexcept>

// ─────────────────────────────────────────────────────────────────────────────
// Event payload sent to JS
// ─────────────────────────────────────────────────────────────────────────────

struct ClientEvent {
    enum class Kind { CONNECTED, DATA, CLOSE, ERROR } kind;
    std::string payload; // DATA: received bytes; ERROR: message
};

// ─────────────────────────────────────────────────────────────────────────────
// TCPClient — manages a single outbound socket
// ─────────────────────────────────────────────────────────────────────────────

class TCPClient {
public:
    static constexpr int MAX_EVENTS = 8;

    TCPClient() : sock_fd_(-1), epoll_fd_(-1), running_(false) {}
    ~TCPClient() { Disconnect(); }

    /**
     * Connect to `host:port`.
     * Because we use a non-blocking socket, connect() returns EINPROGRESS
     * immediately. We register EPOLLOUT to detect completion, then switch to
     * EPOLLIN | EPOLLET for normal data reception.
     */
    void Connect(const std::string& host, int port, Napi::ThreadSafeFunction tsfn) {
        if (running_) return;
        tsfn_ = std::move(tsfn);

        // 1. Socket
        sock_fd_ = ::socket(AF_INET, SOCK_STREAM | SOCK_NONBLOCK, 0);
        if (sock_fd_ < 0)
            throw std::runtime_error("socket() failed: " + std::string(strerror(errno)));

        int flag = 1;
        ::setsockopt(sock_fd_, IPPROTO_TCP, TCP_NODELAY, &flag, sizeof(flag));

        // 2. Resolve and connect
        struct sockaddr_in addr{};
        addr.sin_family = AF_INET;
        addr.sin_port   = htons(static_cast<uint16_t>(port));
        if (::inet_pton(AF_INET, host.c_str(), &addr.sin_addr) <= 0)
            throw std::runtime_error("inet_pton() failed for host: " + host);

        int rc = ::connect(sock_fd_,
                           reinterpret_cast<struct sockaddr*>(&addr),
                           sizeof(addr));
        if (rc < 0 && errno != EINPROGRESS)
            throw std::runtime_error("connect() failed: " + std::string(strerror(errno)));

        // 3. epoll
        epoll_fd_ = ::epoll_create1(EPOLL_CLOEXEC);
        if (epoll_fd_ < 0)
            throw std::runtime_error("epoll_create1() failed: " + std::string(strerror(errno)));

        // Register EPOLLOUT to detect connect() completion
        struct epoll_event ev{};
        ev.events  = EPOLLOUT | EPOLLET;
        ev.data.fd = sock_fd_;
        ::epoll_ctl(epoll_fd_, EPOLL_CTL_ADD, sock_fd_, &ev);

        running_ = true;
        loop_thread_ = std::thread(&TCPClient::EventLoop, this);
    }

    void Disconnect() {
        if (!running_) return;
        running_ = false;
        if (epoll_fd_ >= 0) { ::close(epoll_fd_); epoll_fd_ = -1; }
        if (sock_fd_ >= 0)  { ::close(sock_fd_);  sock_fd_  = -1; }
        if (loop_thread_.joinable()) loop_thread_.join();
        tsfn_.Release();
    }

    bool Send(const std::string& data) {
        if (sock_fd_ < 0 || !running_) return false;
        const char* buf = data.c_str();
        size_t remaining = data.size();
        while (remaining > 0) {
            ssize_t n = ::send(sock_fd_, buf, remaining, MSG_NOSIGNAL);
            if (n < 0) {
                if (errno == EAGAIN || errno == EWOULDBLOCK) continue;
                return false;
            }
            buf += n;
            remaining -= static_cast<size_t>(n);
        }
        return true;
    }

private:
    void EventLoop() {
        bool connected = false;
        struct epoll_event events[MAX_EVENTS];

        while (running_) {
            int nfds = ::epoll_wait(epoll_fd_, events, MAX_EVENTS, 200);
            if (nfds < 0) {
                if (errno == EINTR) continue;
                break;
            }

            for (int i = 0; i < nfds; ++i) {
                uint32_t ev = events[i].events;

                if (!connected) {
                    // ── Detect connect() completion via EPOLLOUT ───────────
                    int err = 0;
                    socklen_t len = sizeof(err);
                    ::getsockopt(sock_fd_, SOL_SOCKET, SO_ERROR, &err, &len);

                    if (err != 0) {
                        auto* e = new ClientEvent{
                            ClientEvent::Kind::ERROR,
                            "connect() completed with error: " + std::string(strerror(err))
                        };
                        tsfn_.NonBlockingCall(e, JsCallback);
                        running_ = false;
                        return;
                    }

                    connected = true;

                    // Re-register for EPOLLIN | EPOLLET (data mode)
                    struct epoll_event data_ev{};
                    data_ev.events  = EPOLLIN | EPOLLET | EPOLLRDHUP;
                    data_ev.data.fd = sock_fd_;
                    ::epoll_ctl(epoll_fd_, EPOLL_CTL_MOD, sock_fd_, &data_ev);

                    auto* e = new ClientEvent{ ClientEvent::Kind::CONNECTED, "" };
                    tsfn_.NonBlockingCall(e, JsCallback);

                } else if (ev & (EPOLLERR | EPOLLHUP | EPOLLRDHUP)) {
                    // ── Peer closed or error ───────────────────────────────
                    auto* e = new ClientEvent{ ClientEvent::Kind::CLOSE, "" };
                    tsfn_.NonBlockingCall(e, JsCallback);
                    running_ = false;
                    return;

                } else if (ev & EPOLLIN) {
                    // ── Drain all available data ───────────────────────────
                    DrainRead();
                }
            }
        }
    }

    void DrainRead() {
        std::string accumulated;
        char buf[4096];

        while (true) {
            ssize_t n = ::recv(sock_fd_, buf, sizeof(buf), 0);
            if (n > 0) {
                accumulated.append(buf, static_cast<size_t>(n));
            } else if (n == 0) {
                // EOF
                if (!accumulated.empty()) {
                    auto* e = new ClientEvent{ ClientEvent::Kind::DATA, std::move(accumulated) };
                    tsfn_.NonBlockingCall(e, JsCallback);
                }
                auto* close_e = new ClientEvent{ ClientEvent::Kind::CLOSE, "" };
                tsfn_.NonBlockingCall(close_e, JsCallback);
                running_ = false;
                return;
            } else {
                if (errno == EAGAIN || errno == EWOULDBLOCK) break;
                auto* e = new ClientEvent{
                    ClientEvent::Kind::ERROR, std::string(strerror(errno))
                };
                tsfn_.NonBlockingCall(e, JsCallback);
                running_ = false;
                return;
            }
        }

        if (!accumulated.empty()) {
            auto* e = new ClientEvent{ ClientEvent::Kind::DATA, std::move(accumulated) };
            tsfn_.NonBlockingCall(e, JsCallback);
        }
    }

    static void JsCallback(Napi::Env env, Napi::Function js_cb,
                           ClientEvent* data) {
        if (env == nullptr || data == nullptr) { if (data) delete data; return; }

        std::string kind_str;
        switch (data->kind) {
            case ClientEvent::Kind::CONNECTED: kind_str = "connected"; break;
            case ClientEvent::Kind::DATA:      kind_str = "data";      break;
            case ClientEvent::Kind::CLOSE:     kind_str = "close";     break;
            case ClientEvent::Kind::ERROR:     kind_str = "error";     break;
        }

        Napi::Object obj = Napi::Object::New(env);
        obj.Set("kind",    Napi::String::New(env, kind_str));
        obj.Set("payload", Napi::String::New(env, data->payload));
        delete data;

        js_cb.Call({obj});
    }

    int  sock_fd_;
    int  epoll_fd_;
    std::atomic<bool>         running_;
    std::thread               loop_thread_;
    Napi::ThreadSafeFunction  tsfn_;
};

// ─────────────────────────────────────────────────────────────────────────────
// NAPI wrapper
// ─────────────────────────────────────────────────────────────────────────────

class NativeTCPClient : public Napi::ObjectWrap<NativeTCPClient> {
public:
    static Napi::Object Init(Napi::Env env, Napi::Object exports) {
        Napi::Function func = DefineClass(env, "NativeTCPClient", {
            InstanceMethod<&NativeTCPClient::Connect>("connect"),
            InstanceMethod<&NativeTCPClient::Disconnect>("disconnect"),
            InstanceMethod<&NativeTCPClient::Send>("send"),
        });
        exports.Set("NativeTCPClient", func);
        return exports;
    }

    NativeTCPClient(const Napi::CallbackInfo& info)
        : Napi::ObjectWrap<NativeTCPClient>(info) {}

private:
    // connect(host: string, port: number, cb: Function)
    Napi::Value Connect(const Napi::CallbackInfo& info) {
        Napi::Env env = info.Env();
        if (info.Length() < 3 ||
            !info[0].IsString() || !info[1].IsNumber() || !info[2].IsFunction()) {
            Napi::TypeError::New(env, "connect(host, port, cb) expected")
                .ThrowAsJavaScriptException();
            return env.Undefined();
        }
        std::string host = info[0].As<Napi::String>().Utf8Value();
        int port = info[1].As<Napi::Number>().Int32Value();
        Napi::Function cb = info[2].As<Napi::Function>();

        auto tsfn = Napi::ThreadSafeFunction::New(env, cb, "TCPClientTSFN", 0, 1);
        try {
            client_.Connect(host, port, std::move(tsfn));
        } catch (const std::exception& ex) {
            Napi::Error::New(env, ex.what()).ThrowAsJavaScriptException();
        }
        return env.Undefined();
    }

    Napi::Value Disconnect(const Napi::CallbackInfo& info) {
        client_.Disconnect();
        return info.Env().Undefined();
    }

    Napi::Value Send(const Napi::CallbackInfo& info) {
        Napi::Env env = info.Env();
        if (info.Length() < 1 || !info[0].IsString()) {
            Napi::TypeError::New(env, "send(data: string) expected")
                .ThrowAsJavaScriptException();
            return Napi::Boolean::New(env, false);
        }
        std::string data = info[0].As<Napi::String>().Utf8Value();
        return Napi::Boolean::New(env, client_.Send(data));
    }

    TCPClient client_;
};

// ─────────────────────────────────────────────────────────────────────────────
// Module entry point (shared with tcp_server via combined native_transport.cpp)
// ─────────────────────────────────────────────────────────────────────────────

// NOTE: NativeTCPClient::Init is called from native_transport.cpp which
// aggregates both server and client into one NODE_API_MODULE.
// This file exposes the symbol for linking.
void RegisterTCPClient(Napi::Env env, Napi::Object exports) {
    NativeTCPClient::Init(env, exports);
}

#endif // __linux__
