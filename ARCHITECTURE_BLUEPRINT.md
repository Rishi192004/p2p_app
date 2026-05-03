# System Architecture Blueprint: P2P Gossip Mesh

This document provides a mechanical-style blueprint of the system architecture, mapping every logical component to its actual implementation in the codebase.

## 📐 High-Level Block Diagram

```mermaid
graph TD
    subgraph "Control Layer (Node.js)"
        Orchestrator[P2PNode Orchestrator<br/>'The Glue']
    end

    subgraph "Discovery & Topology"
        mDNS[mDNS Discovery<br/>'LAN Zero-Config']
        Bootstrap[Bootstrap Nodes<br/>'WAN Entry Point']
        PEX[Peer Exchange - PEX<br/>'Topology Gossip']
        PeerManager[Peer Manager<br/>'ACTIVE -> SUSPECTED -> DEAD']
    end

    subgraph "Protocol Layer (Node.js)"
        GossipEngine[Gossip Engine<br/>'Fanout-k, TTL, Topic Routing']
        AckManager[Ack Manager<br/>'Retry Logic, Delivery Conf']
        LamportClock[Lamport Clock<br/>'Causal Ordering']
        RateLimiter[Rate Limiter<br/>'Token Bucket Protection']
        SeenCache[Seen Message Cache<br/>'Deduplication Set']
    end

    subgraph "Security Layer (libsodium)"
        SecurityManager[Security Manager<br/>'Verification Orchestrator']
        KeyManager[Key Manager<br/>'Ed25519 Signing']
        Encryptor[Encryptor<br/>'XSalsa20-Poly1305']
    end

    subgraph "Storage Layer (LevelDB)"
        MessageStore[Message Store<br/>'LSM-Tree Persistence']
        SyncManager[Sync Manager<br/>'Delta-Sync via Range Scan']
    end

    subgraph "Transport Layer (WebSockets)"
        ConnPool[Connection Pool<br/>'Peer State Mgmt']
        WSServer[WebSocket Server<br/>'Inbound Traffic']
        WSClient[WebSocket Client<br/>'Outbound Gossip']
    end

    %% Data Flow - Incoming
    WSServer -- "Encrypted/Signed Frame" --> SecurityManager
    SecurityManager -- "Verified Message" --> RateLimiter
    RateLimiter -- "Throttled Message" --> GossipEngine
    GossipEngine -- "New Message Check" --> SeenCache
    GossipEngine -- "Causal Order" --> LamportClock
    GossipEngine -- "Persistent Write" --> MessageStore

    %% Data Flow - Outgoing
    Orchestrator -- "Publish(content)" --> KeyManager
    KeyManager -- "Signed Message" --> GossipEngine
    GossipEngine -- "Broadcast" --> ConnPool
    ConnPool -- "Gossip Broadcast" --> WSClient

    %% Specialized Flows
    AckManager -- "ACK Message" --> ConnPool
    SyncManager -- "Delta Sync Request" --> ConnPool
    MessageStore -- "Range Scan Result" --> SyncManager
    SyncManager -- "Sync Batch" --> GossipEngine

    %% Heartbeat & Failure Path
    WSClient -- "Heartbeat (5s)" --> PeerManager
    PeerManager -- "Timeout (15s)" --> ConnPool
    ConnPool -- "Purge DEAD Peer" --> Orchestrator

    classDef layer fill:#f9f,stroke:#333,stroke-width:2px;
    classDef tech fill:#fff,stroke:#333,stroke-dasharray: 5 5;
```

## 🛠️ Layered Component Breakdown

### 1. Transport Layer (WebSockets)
- **Technology**: `ws` library (Node.js).
- **Purpose**: Low-latency, full-duplex communication over unstable networks.
- **Components**: 
    - `ConnectionPool`: The central registry for all active peer sockets.
    - `WSServer`: Listens for incoming connections and initiates the HELLO handshake.
    - `WSClient`: Handles outbound connections with exponential backoff.

### 2. Security Layer (libsodium)
- **Technology**: `sodium-native`.
- **Purpose**: Authenticated encryption and non-repudiation.
- **Components**:
    - `SecurityManager`: Validates message signatures before they reach the protocol layer.
    - `KeyManager`: Manages Ed25519 (Signing) and X25519 (Encryption) keys.

### 3. Protocol Layer (Node.js)
- **Technology**: Custom Event-Driven Logic.
- **Purpose**: Distributed consensus and propagation rules.
- **Components**:
    - `GossipEngine`: Implements epidemic fanout-k propagation.
    - `LamportClock`: Ensures causal ordering without a global clock.
    - `RateLimiter`: Token bucket implementation to prevent spam.

### 4. Storage Layer (LevelDB)
- **Technology**: `level` (LSM-tree).
- **Purpose**: Persistence and efficient delta-synchronization.
- **Components**:
    - `MessageStore`: Handles structured indexing for fast retrieval.
    - `SyncManager`: Resolves network partitions via timestamped range scans.

---
*Created by: Rishi192004*
*Verified by VibeCheck ✅*
