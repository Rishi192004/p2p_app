# Native epoll TCP Transport — Technical Deep Dive

## Architecture Overview

```
JavaScript Layer (Node.js event loop)
│
│  transport/index.js          ← Adaptive Factory (selects transport)
│  transport/nativeTransport.js ← JS bridge / event adapter
│
├── [Linux] ──────────────────────────────────────────────────────────
│   build/Release/native_transport.node   ← compiled C++ addon (.node)
│   │
│   ├── NativeTCPServer  (tcp_server.cpp)
│   │     socket() → bind() → listen() → epoll_create1() → EPOLLET loop
│   │     std::thread runs EventLoop() — never blocks Node's event loop
│   │
│   └── NativeTCPClient  (tcp_client.cpp)
│         Non-blocking connect(), EPOLLOUT → detect completion
│         Re-registers EPOLLIN | EPOLLET for data phase
│
└── [Non-Linux] ──────────────────────────────────────────────────────
    transport/wsServer.js  + transport/wsClient.js  (WebSocket fallback)
```

## Why epoll over select/poll?

| Property              | `select` / `poll`   | `epoll`              |
|-----------------------|---------------------|----------------------|
| Scan per call         | O(N) all fds        | O(1) — only ready k  |
| FD limit (Linux)      | 1024 (select)       | Millions             |
| Registration          | Per-call copy       | One-time `EPOLL_CTL_ADD` |
| Edge-Triggered        | ✗                   | ✓ `EPOLLET`          |
| Kernel buffer sharing | ✗                   | ✓ (mmap'd event list) |

`epoll_wait()` returns **only** the sockets that have data ready. No iteration over idle connections. This is the O(1) claim.

## Edge-Triggered (EPOLLET) semantics

```
Level-Triggered (default):  Fires repeatedly while data is in the buffer.
                             → Simpler code, but can cause busy-loops.

Edge-Triggered (EPOLLET):   Fires ONCE when state changes (empty → non-empty).
                             → Requires drain-loop (read until EAGAIN).
                             → Zero spurious wakeups. Lower CPU overhead.
```

Our `DrainRead()` method:
```cpp
while (true) {
    ssize_t n = ::recv(fd, buf, sizeof(buf), 0);
    if (n > 0)  { accumulated.append(buf, n); }
    else if (n == 0)  { /* EOF */ RemovePeer(fd); return; }
    else if (errno == EAGAIN || errno == EWOULDBLOCK) break; // Drained ✓
    else { /* hard error */ RemovePeer(fd); return; }
}
```

## ThreadSafeFunction (TSFN)

The C++ event loop runs on `std::thread`. Calling JavaScript from a non-JS thread is undefined behaviour in V8. `Napi::ThreadSafeFunction` is the correct NAPI mechanism:

```
C++ thread          ──── tsfn_.NonBlockingCall(data, JsCallback) ────►
                                                                       Node.js event loop
                                                                       JsCallback(env, js_fn, data)
                                                                       │
                                                                       ▼
                                                                       emits 'message' / 'connection'
```

`NonBlockingCall` enqueues the callback without blocking the C++ thread. The callback is dequeued and invoked on the next JS event-loop tick.

## Graceful Degradation

```javascript
// transport/index.js
const onLinux   = os.platform() === 'linux';
const useNative = onLinux && isNativeAvailable;   // both must be true

export const createServer = (port, peerId, key) =>
    useNative ? new NativeServer(...) : new WSServer(...);
```

- **On Windows / macOS**: `NativeTCPServer` is never instantiated. WSServer handles everything.
- **On Linux, addon not built**: `isNativeAvailable = false`. Same fallback.
- **On Linux, addon built**: epoll path, O(1) dispatch.

## Build Instructions (Linux / WSL2)

```bash
# Install build toolchain
sudo apt-get install build-essential python3

# Compile the native_transport target only
npm run build:native

# Run comparative benchmark
npm run bench:native
```

Expected output on Linux:
```
🟢  Raw TCP (net module)         Avg RTT: 0.18 ms
🟢  WebSocket (ws library)       Avg RTT: 0.41 ms
🟢  Native TCP (epoll/EPOLLET)   Avg RTT: 0.09 ms
✓ Native TCP is 4.56x faster than WebSocket on this machine
```

## Interview Talking Points

1. **"Why not libuv?"** — Node.js uses libuv internally, which wraps epoll. By going native we eliminate the libuv abstraction layer and its callback scheduling overhead, reaching the syscall directly.

2. **"What about thread safety?"** — All socket operations happen on the `std::thread`. The only cross-thread interaction is via `ThreadSafeFunction`, which is the V8-sanctioned mechanism. No raw V8 calls from C++ threads.

3. **"EAGAIN vs blocking sockets"** — Non-blocking sockets return `EAGAIN` immediately when the kernel buffer is empty, rather than suspending the thread. Combined with EPOLLET, this means the epoll thread is never blocked waiting for I/O — it moves to the next ready fd or returns to `epoll_wait`.

4. **"TCP_NODELAY"** — We disable Nagle's algorithm (`setsockopt(TCP_NODELAY)`) so small gossip messages aren't coalesced. This trades throughput for latency, which is correct for a real-time gossip system.

5. **"Backpressure"** — Our current `Send()` retries on `EAGAIN`. In production, you'd register `EPOLLOUT` on the fd and drain a per-fd write buffer to implement proper backpressure without busy-spinning.
