# P2P Gossip Mesh

A production-grade, decentralized peer-to-peer gossip system with end-to-end security, offline synchronization, and comprehensive observability.

[**Read the Engineering Deep Dive (Interview Ready)**](TECHNICAL_DEEP_DIVE.md) | [**View Architecture Blueprint**](ARCHITECTURE_BLUEPRINT.md)

## 🚀 Quick Start

Run a local 5-node mesh demo with a single command:
```bash
npm install
node scripts/demo.js
```

Start an interactive CLI node:
```bash
# Node 1
PEER_ID=alpha PORT=8080 node client/cliClient.js

# Node 2 (connects to alpha)
PEER_ID=beta PORT=8081 BOOTSTRAP_NODES='["ws://localhost:8080"]' node client/cliClient.js
```

## 🏗️ Architecture

```text
       [ CLI Client / API ]
               |
    +----------V----------+
    |      P2P Node       | <--- Orchestrator
    +---------------------+
    |   Gossip Engine     | <--- [ Protocol Layer ]
    | (Topic Router, TTL) |
    +---------------------+
    |  Security Manager   | <--- [ Security Layer ]
    | (Ed25519, X25519)   |
    +---------------------+
    |   Message Store     | <--- [ Storage Layer ]
    |     (LevelDB)       |
    +---------------------+
    |  Connection Pool    | <--- [ Transport Layer ]
    |    (WebSockets)     |
    +----------+----------+
               |
         [ P2P Mesh ]
```

## ✨ Features

- **Epidemic Gossip**: O(log N) propagation using seen-message caches and fanout.
- **Layered Discovery**: Multi-vector discovery using mDNS (LAN), Bootstrap nodes (WAN), and PEX (Gossip).
- **E2E Security**: Ed25519 digital signatures and XSalsa20-Poly1305 authenticated encryption via `libsodium`.
- **Causal Ordering**: Lamport logical clocks for ordering messages without a global clock.
- **Offline Sync**: Delta-synchronization using LevelDB range scans for peers rejoining after partitions.
- **Spam Protection**: Token Bucket rate limiting and temporary peer banning.
- **Production Observability**: Reservoir-sampled metrics (p99 latency) and structured JSON logging.

## 🛠️ Configuration

Environment variables used by the node:
- `PEER_ID`: Unique identity for this node.
- `PORT`: WebSocket server port.
- `BOOTSTRAP_NODES`: JSON array of WS URLs (e.g., `["ws://localhost:8080"]`).
- `DB_PATH`: Directory for LevelDB storage.
- `LOG_LEVEL`: `trace`, `debug`, `info`, `warn`, `error`.

## 📈 Design Decisions & Tradeoffs

### 1. AP over CP (CAP Theorem)
We prioritize **Availability** and **Partition Tolerance**. In a distributed chat, preventing users from sending messages because a majority quorum isn't reachable is a poor UX. We accept eventual consistency via gossip and delta-sync.

### 2. Embedded LevelDB over Redis
A true P2P node should be self-contained. Using an embedded database removes external dependencies and network overhead, ensuring the node can run on edge devices or desktops without infrastructure.

### 3. Unstructured Gossip over Kademlia (DHT)
While DHTs are great for key-value lookups in massive networks, unstructured gossip is simpler and more robust for message broadcast in smaller, highly connected meshes. It avoids the complexity of bucket maintenance while still providing O(log N) reach.

### 4. Ed25519 over RSA
Modern elliptic curve signatures are smaller (64 bytes) and significantly faster to compute/verify. This is critical in a gossip network where every node must verify every message before forwarding.

## 🚀 Scaling to 1M Nodes: What I'd do differently

1. **UDP/QUIC Transport**: WebSockets carry TCP's Head-of-Line blocking and handshake overhead. Moving to QUIC would provide better performance on unstable networks.
2. **Pluggable Discovery**: Integrate Kademlia DHT for finding peers when bootstrap nodes are unreachable.
3. **Zero-Knowledge Spam Defense**: Implement ZK-proofs or VDFs (Verifiable Delay Functions) to make spamming computationally expensive without revealing user identity.
4. **Merkle Tree Anti-Entropy**: Use Merkle trees to detect state differences between peers instantly during sync, rather than replaying logs by timestamp.
5. **Double Ratchet PFS**: Move from static shared secrets to the Signal Protocol for Perfect Forward Secrecy in every direct message.

---
*Built for High-Scale Decentralized Communications.*
