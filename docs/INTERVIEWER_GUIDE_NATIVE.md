# Interviewer's Guide: Native epoll Transport Verification

This guide provides a 5-minute walkthrough to verify the low-level systems engineering claims in this project.

## 1. Prerequisites (Linux/WSL2)
The native transport requires a Linux environment to leverage the `epoll` syscall. 
- **Dependencies**: `build-essential`, `python3`, `nodejs` (v18+).

## 2. Quick-Start Verification (The 2-Minute Test)

Run the following inside the project root:
```bash
# Compile the native C++ engine
npm run build:native

# Run the comparative benchmark
npm run bench:native
```

### What to Look For:
- **`Phase 1`**: Verify `Native TCP (epoll/EPOLLET)` is listed as **🟢 Available**.
- **`Phase 2`**: Observe the latency results. The Native TCP RTT should be comparable to or lower than the standard WebSocket transport, demonstrating zero-overhead N-API bridging.

## 3. Deep-Dive Questions to Ask the Candidate

### "Why use EPOLLET (Edge-Triggered) instead of Level-Triggered?"
*   **Target Answer**: "EPOLLET is more efficient for high-concurrency servers because it notifies the application only when there is a state change (e.g., from empty to data-ready). This reduces the number of syscalls and prevents the 'thundering herd' problem, but it requires a 'drain-loop' logic (reading until `EAGAIN`) to ensure no data is missed."

### "How do you handle thread safety between the C++ event loop and Node.js?"
*   **Target Answer**: "The native transport runs its own `epoll` loop on a dedicated `std::thread`. To safely send data back to JavaScript without corrupting the V8 state, I use `Napi::ThreadSafeFunction` (TSFN). This enqueues callbacks to be executed on the main Node.js event loop thread."

### "Explain the O(1) complexity claim."
*   **Target Answer**: "Unlike `poll()` or `select()`, which have O(N) complexity because they must scan every file descriptor on every call, `epoll_wait()` only returns the list of file descriptors that are actually ready. This means the system stays fast even if there are 10,000 idle connections."

## 4. Code Inspection Points
- **`src/native/transport/tcp_server.cpp`**: Inspect the `EventLoop()` method and the `DrainRead()` loop.
- **`transport/index.js`**: See the "Adaptive Transport Factory" that detects the environment and switches engines.
- **`binding.gyp`**: Observe the conditional compilation flags (`OS=="linux"`).

## 5. Stress Testing (Optional)
To verify the system's resilience under load:
```bash
npm run stress-test
```
This spawns multiple nodes and flood-broadcasts 50,000 messages to verify mesh stability and storage integrity.
