# P2P Gossip Mesh — Distributed Topic Routing & Messaging System

A production-grade, self-sovereign, and decentralized peer-to-peer gossip messaging network featuring a high-performance native transport layer, end-to-end cryptographic security, causal message ordering, soft-state distance-vector topic routing, and multi-topic delta-sync flow control.

[**Read the Engineering Deep Dive**](TECHNICAL_DEEP_DIVE.md) | [**View Architecture Blueprint**](ARCHITECTURE_BLUEPRINT.md) | [**Full Project Summary**](PROJECT_SUMMARY.md) | [**Test Report**](TEST_REPORT.md)

---

## ⚡ Interactive Technical Showcase

Run the systems engineering command to run the interactive console demonstration which showcases all core and minor properties of the protocol in action (7 distinct phases):

```bash
npm run interview
```

---

## 🏗️ System Architecture

The node coordinates multiple isolated subsystems dynamically using an **Adaptive Transport Factory**. It detects the host OS at runtime, preferring the native C++ epoll transport on Linux (with edge-triggered file descriptor polling) and falling back gracefully to WebSocket framing on Windows/macOS.

```text
       [ CLI Client / API ]
               │
    ┌────────────────────────┐
    │  P2PNode Orchestrator  │  <─── Coordinates transport, storage, security, routing
    └──────────┬─────────────┘
               │
   ┌───────────┼────────────┬─────────────┬─────────────┐
   │           │            │             │             │
[Gossip]    [Sync]      [Security]   [Discovery]    [Metrics]
   │           │            │             │             │
GossipEngine SyncManager KeyManager  mDNSDiscovery  Collector
TopicRouter  AckManager  Encryptor   BootstrapDisco Reporter
                         SecManager  PeerExchange   /metrics
   │           │            │             │             │
   └───────────┼────────────┼─────────────┼─────────────┘
               │
    ┌──────────▼─────────────┐
    │   LevelDB Store        │  <─── LSM-Tree Sorted Range-Scans
    └────────────────────────┘
               │
    ┌──────────▼─────────────┐
    │   Adaptive Transport   │  <─── C++ epoll(7) vs. ws (WebSocket)
    └────────────────────────┘
```

---

## ✨ Core Protocol Capabilities

### 1. Proof-of-Work Sybil Defense
To prevent identity spoofing and flood spamming, every message requires a valid Proof-of-Work puzzle token computed over its unique payload ID. The verification is `O(1)` checking that the FNV-1a hash matches the target bits.
*   **Linux Native**: Fast brute-forcing written in native C++ (`src/native/pow.cpp`).
*   **Cross-platform fallback**: Implemented in clean JavaScript (`utils/pow.js`) for Windows and macOS.

### 2. Token-Bucket Rate Limiting & Banning
Nodes protect socket buffers and CPU from degrades by enforcing a Token-Bucket algorithm (Refill: 5 tokens/sec, Capacity: 20 tokens). Peer IDs that violate limits repeatedly trigger an automatic **5-minute blacklist ban**, immediately closing sockets and discarding inbound frames.

### 3. Cryptographic Identity & Transport Security
*   **Ed25519 Digital Signatures**: Every gossip envelope is signed by the originator's private key. Senders cannot deny origin, and transit peers cannot modify payloads without failing signature checks.
*   **XSalsa20-Poly1305 AEAD Encryption**: One-to-one Direct Messages (DMs) are encrypted using symmetric keys derived via X25519 ECDH key agreement.

### 4. Causal Ordering & LevelDB Storage
*   **Lamport Logical Clocks**: Guarantees event causality ordering (`Time(A) < Time(B)`) across asynchronous actors.
*   **Composite Lexicographical Storage Keys**: Message data is written to LevelDB under composite keys structured as `msg:{topic}:{paddedLamportTs}:{messageId}`. Range queries fetch topic deltas in chronological order with single-pass database iterators.

### 5. Soft-State Distance-Vector Topic Routing
*   **Multi-hop Delivery**: Nodes dynamically build next-hop routing tables by propagating Subscription Advertisements (`SUB_AD` control frames). Non-subscribed intermediate peers route topic-specific messages to interested zones without global flooding.
*   **Path-Vector Loop Prevention**: Subscription paths are appended to advertisements; routing loops are automatically detected and dropped.
*   **Soft-State Expiry**: Route leases must be renewed; a background Garbage Collection (GC) thread automatically drops expired routes.

### 6. Multi-Topic Reconnection Delta Synchronization
When a peer reconnects after a disconnect:
1.  The node queries the routing table to find all active subscriptions for the peer (`topicRouter.getTopicsForPeer`).
2.  It scans the database for messages on those specific topics since the peer's last seen Lamport timestamp.
3.  Missed messages are aggregated, sorted by Lamport timestamp (guaranteeing causal consistency), and streamed.
4.  Transmission is gated by **Sliding-Window ACK Backpressure** to prevent buffer bloat and receiver starvation.

### 7. Layered Discovery Mesh
*   **LAN mDNS**: Zero-configuration local discovery on port `_p2p._tcp.local`.
*   **Bootstrap Entry**: Static seed node addresses with exponential reconnect backoff.
*   **Peer Exchange (PEX)**: Gossip-based network topology healing and mesh propagation.

---

## 🚀 Execution & Command Reference

### Docker-Compose Local Mesh
The fastest way to test a local 3-node cluster:
```bash
docker-compose up --build
```
This starts `alpha` (8080), `beta` (8081), and `gamma` (8082) connected in a mesh.

### Comparative Native Transport Benchmarks (Linux)
Compile the C++ transport addon and verify epoll speed versus WebSockets:
```bash
# Compile native targets
npm run build:native

# Smoke-test compiled bindings
npm run verify:native

# Execute performance benchmark
npm run bench:native
```

### High-Volume Scale Test
Ingest and sync **50,000 messages** through the system under high load:
```bash
npm run stress-test
```

### Verification & Performance Audit
Run the entire unit and integration test suite (66 tests):
```bash
npm test
```
Run the latency audit verifying p99 propagation lag (< 15ms):
```bash
npm run test:performance
```

---

## 📊 Obsesrvability Dashboard & visualizer

The codebase includes an interactive React + Vite **Gossip Visualizer** (`visualizer/`).
*   **Force-directed topology graph**: Shows live node nodes, active connections, and gossip transmission waves.
*   **Metrics panel**: Visualizes node throughput, message delivery rates, p99 transport latency, and LevelDB disk read/writes.
*   **Chaos triggers**: Simulates link latency injection and packet drops interactively.

To launch the visualizer:
```bash
cd visualizer
npm install
npm run dev
```

---

## 🛠️ Tech Stack & Key Libraries

*   **Runtime**: Node.js (v20 LTS, ESM)
*   **Database**: LevelDB (`level` ^8.0.1) & memory-level (^3.1.0)
*   **Crypto**: libsodium bindings (`sodium-native` ^4.0.4)
*   **Discovery**: `mdns-js` (^1.0.3)
*   **Websockets**: `ws` (^8.14.2)
*   **Native compilation**: `node-gyp` (^8.7.0)
*   **Logger**: structured JSON logger `pino` (^8.16.2)

---

## 📐 CAP Theorem Position

This network is designed as an **AP (Available / Partition Tolerant)** system. 
During a network partition, all subnets remain fully operational, accepting and storing incoming messages locally. Once connectivity returns, the `SyncManager` performs delta reconciliation based on Lamport clocks to heal the state. We accept eventual consistency to ensure zero-block chat availability.
