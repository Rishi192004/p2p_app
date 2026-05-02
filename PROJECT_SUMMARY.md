# Architectural Post-Mortem & System Design: p2p_app

## Executive Summary
A production-grade, decentralized peer-to-peer (P2P) chat system built on a serverless mesh architecture. Each node is a fully sovereign participant, handling discovery, state synchronization, and message propagation without reliance on central infrastructure.

> **Senior Dev Note for Juniors**: This project isn't just a "chat app." It is a study in distributed systems. Pay attention to how we handle the lack of a "global clock" and how we manage state when any node can fail at any time.

---

## 1. Core Architectural Philosophies

### Distributed Sovereignty
Unlike traditional client-server models (Hub-and-Spoke), this system uses a **Mesh Topology**. 
- **Pros**: No single point of failure; censorship resistance; scales horizontally by adding nodes.
- **Cons**: Extremely difficult to achieve global consensus; network partitions lead to data divergence.

### CAP Theorem & Tradeoffs
This system is strictly **AP (Available + Partition Tolerant)**.
- **Why?** In a chat system, "Availability" (being able to send a message while offline or partitioned) is more important than "Consistency" (everyone seeing the exact same state at the exact same microsecond). 
- **The Tradeoff**: We accept **Eventual Consistency**. Messages may arrive out of order or after a delay, but the system will eventually converge on a shared state.

---

## 2. System Components & Senior Rationale

### A. Transport Layer (`transport/`)
*Focus: Connection Resilience*
- **WS Server/Client**: Uses WebSockets for full-duplex communication.
- **Tradeoff - WS vs TCP**: We chose WebSockets to allow for easier future integration with browser-based nodes, even though raw TCP might have slightly lower overhead.
- **Connection Pool**: Manages the "Topological Health" of the node. It enforces limits to prevent "File Descriptor Exhaustion" (a common production pitfall).

### B. Protocol Layer (`protocol/`)
*Focus: Causal Order & Epidemic Propagation*
- **Gossip Engine**: Implements an **Epidemic Protocol**.
- **Lamport Clocks**: Our solution to the "Physical Clock" problem. Since we can't trust peer system clocks, we use logical counters to establish a `happened-before` relationship.
- **Deduplication**: Every node maintains a `seenMessages` cache.
    - **Tradeoff**: Memory vs. Network. We use memory (RAM) to store IDs to prevent "Broadcast Storms" that would otherwise saturate the network bandwidth.

### C. Storage Layer (`storage/`)
*Focus: Data Durability & Range Scans*
- **LevelDB**: An embedded LSM-tree database.
- **Composite Keys**: `msg:{topic}:{lamportTimestamp}:{messageId}`.
    - **Senior Secret**: By prefixing with `topic` and `timestamp`, we turn a Key-Value store into a sorted index. This allows "Sync via Range Scan" which is significantly faster than filtering through a list.
- **Batching Strategy**: We buffer writes (50 msgs / 100ms).
    - **Tradeoff**: Durability vs. Performance. A crash might lose 100ms of data, but disk longevity and write throughput increase by 10x.

### D. Sync Manager (`storage/syncManager.js`)
*Focus: Partition Resolution*
- **Log Replay**: When a peer reconnects, we don't send the whole database. We use the last known Lamport time to perform a "Delta Sync."
- **Rate Limiting**: Syncing 10,000 missed messages at once would kill the connection. We use "Burst-and-Pause" logic to maintain transport stability.

---

## 3. Algorithm Deep Dive: "The Senior Why"

| Problem | Solution | Architectural Rationale (The "Why") |
| :--- | :--- | :--- |
| **Global State** | **Gossip (Push)** | Broadcast is O(N^2). Gossip with Fanout=K is much more efficient, reaching the whole network in O(log N) hops. |
| **Message Ordering** | **Lamport Clocks** | Physical time is a lie in distributed systems. Logical time ensures causality (A -> B). |
| **Infinite Loops** | **Seen Cache (Set)** | O(1) lookups are mandatory. An array search here would turn the node into a CPU bottleneck. |
| **Dead Peer Detection** | **Suspicion Machine** | Avoids "Flapping." We don't mark a peer DEAD on the first missed heartbeat; we mark it SUSPECTED first. |
| **Offline Recovery** | **Delta Sync** | Essential for the "Mobile Use Case" where peers frequently drop and rejoin. |

---

## 4. Junior Dev Study Guide

If you are studying this codebase, focus on these three patterns:

1.  **Idempotency**: Notice how `gossipEngine.receiveMessage` can be called multiple times with the same message, but only "processes" it once. This is the foundation of reliable distributed systems.
2.  **Backpressure**: Look at the `syncManager` rate limiting. In production, the fastest way to break a system is to send data faster than the receiver can process it.
3.  **State Isolation**: Observe `node/state.js`. By centralizing state mutation, we avoid "Race Conditions" where two different modules try to update the same peer info at once.

---

## 5. Technical Stack & Implementation Status

- **Runtime**: Node.js (ESM)
- **DB**: LevelDB (Embedded)
- **Status**: Core Gossip, Persistence, and Offline Sync are **Production-Ready**. 
- **Next Steps**: Implementing Ed25519 Message Signing (Security) and mDNS Auto-Discovery.

---
*Created by: Senior Architectural Lead*
*Target Audience: Full-Stack & Systems Engineers*
