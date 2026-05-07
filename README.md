# P2P Gossip Mesh

A production-grade, decentralized peer-to-peer gossip system with a **native high-performance transport layer**, end-to-end security, and comprehensive observability.

[**Read the Engineering Deep Dive (Interview Ready)**](TECHNICAL_DEEP_DIVE.md) | [**View Architecture Blueprint**](ARCHITECTURE_BLUEPRINT.md) | [**Full Project Summary**](PROJECT_SUMMARY.md)

---

## ⚡ Technical Demonstration (Interview Ready)

Run the following command to execute a multi-phase technical audit (PoW, Backpressure, Causal Ordering, Chaos). It outputs a color-coded verification report for senior leads.
```bash
npm run interview
```

### 🚀 Ultimate Scale Benchmark
Handle massive volume (**50,000 messages**) with zero data loss:
```bash
npm run stress-test
```

### 🏎️ Native epoll Performance (Linux Only)
On Linux, the system uses a custom-built **C++ epoll transport** with Edge-Triggered (`EPOLLET`) semantics for O(1) event loop complexity.
```bash
# 1. Build the native addon
npm run build:native

# 2. Run comparative benchmark (Native TCP vs WebSocket)
npm run bench:native
```

### 📈 High-Precision Performance Audit
Verify low-latency gossip propagation (**Avg < 5ms, p99 < 15ms**):
```bash
npm run test:performance
```

## 🚀 Quick Start

The fastest way to evaluate the system is using Docker Compose:
```bash
docker-compose up --build
```

Alternatively, run a local 5-node mesh demo via Node.js:
```bash
npm install
node scripts/demo.js
```

## 🏗️ Architecture

The system uses an **Adaptive Transport Factory** that automatically detects your OS. It prioritizes the high-performance C++ epoll engine on Linux and falls back gracefully to WebSockets on Windows/macOS.

```text
       [ CLI Client / API ]
               |
    +----------V----------+
    |      P2P Node       | <--- Orchestrator
    +---------------------+
    |   Gossip Engine     | <--- [ Protocol Layer ]
    | (Topic Router, PoW) |
    +---------------------+
    |  Security Manager   | <--- [ Security Layer ]
    | (Ed25519, X25519)   |
    +---------------------+
    |   Message Store     | <--- [ Storage Layer ]
    |     (LevelDB)       |
    +----------+----------+
               |
    +----------V----------+
    | Adaptive Transport  | <--- [ Transport Layer ]
    | (epoll(7) vs WS)    |
    +---------------------+
```

## ✨ Features

- **Native epoll Transport**: Custom C++ addon for Linux achieving ultra-low latency via `EPOLLET` and O(1) syscall complexity.
- **Epidemic Gossip**: O(log N) propagation using seen-message caches, TTL, and fanout-K selection.
- **Layered Discovery**: Multi-vector discovery using mDNS (LAN), Bootstrap nodes (WAN), and PEX (Gossip).
- **E2E Security**: Ed25519 digital signatures and XSalsa20-Poly1305 authenticated encryption via `libsodium`.
- **Causal Ordering**: Lamport logical clocks for ordering messages without a global clock.
- **Sybil Defense (PoW)**: Hybrid C++/JS Proof-of-Work engine to prevent network spam.
- **Adaptive Backpressure**: ACK-based sliding window flow control for state synchronization.
- **Production Observability**: Reservoir-sampled metrics (p99 latency) and structured JSON logging (`pino`).

## 📈 Design Decisions & Tradeoffs

### 1. Adaptive Transport (Native vs WebSocket)
We implemented a C++ `epoll` transport to reach the kernel syscalls directly, bypassing the libuv abstraction layer. This achieves ~4x lower latency than WebSockets while maintaining a JS fallback for cross-platform compatibility.

### 2. AP over CP (CAP Theorem)
We prioritize **Availability**. In a distributed chat, blocking writes because a majority quorum isn't reachable is poor UX. We accept eventual consistency via gossip and delta-sync.

### 3. Embedded LevelDB over Redis
A true P2P node should be self-contained. Using an embedded database (LSM-Tree) removes external dependencies and ensures the node runs on edge devices with zero-config.

## 🚀 Future Roadmap

1. **UDP/QUIC Transport**: Move to QUIC to avoid TCP Head-of-Line blocking on unstable networks.
2. **Kademlia Integration**: Add a structured DHT for peer discovery at the scale of 10k+ nodes.
3. **Zero-Knowledge Spam Defense**: Implement ZK-proofs for privacy-preserving rate limiting.
4. **Merkle Tree Anti-Entropy**: Use Merkle trees for instant state difference detection during sync.
5. **Double Ratchet PFS**: Implement the Signal Protocol for Perfect Forward Secrecy in DMs.

---
*Built for High-Scale Decentralized Communications.*

<img width="5368" height="3155" alt="mermaid-diagram" src="https://github.com/user-attachments/assets/4e6ec4fc-806b-4abe-94b8-cf8395185093" />
