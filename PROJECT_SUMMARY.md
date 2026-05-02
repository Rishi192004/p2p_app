# Project Summary: p2p_app

## Objective
A decentralized peer-to-peer (P2P) chat application designed to allow users to communicate without a central server, using direct connections between peers.
**Repository**: [https://github.com/Rishi192004/p2p_app](https://github.com/Rishi192004/p2p_app)

## Architecture Overview
The application follows a distributed architecture where each "node" acts as both a client and a server. It uses a gossip-style message propagation mechanism to ensure messages reach all participants in the network.

## Directory Structure
```text
p2p_app/
├── client/                 # User interface components
├── config/                 # Network and app configurations
│   └── default.js          # Core network constants
├── metrics/                # Latency and delivery tracking
├── node/                   # Core P2P node logic
│   ├── discovery.js        # Peer discovery (mDNS)
│   ├── heartbeatManager.js # Active failure detection (heartbeats)
│   ├── messageHandler.js   # Gossip protocol implementation
│   ├── peerManager.js      # Peer lifecycle and state machine
│   ├── server.js           # WebSocket server entry point
│   └── state.js            # Centralized state store
├── protocol/               # Protocol definitions and factories
│   ├── schema.js           # Canonical JSDoc message schema
│   ├── messageFactory.js   # Message builder for network payloads
│   ├── lamportClock.js     # Logical clock for causal ordering
│   ├── gossipEngine.js     # Core gossip logic and fanout
│   ├── ackManager.js       # Reliable delivery and ACK tracking
│   └── pendingQueue.js     # Offline message buffering
├── security/               # Encryption and signing layer
├── storage/                # Persistence layer (LevelDB)
├── tests/                  # Native Node.js test suite
│   ├── e2e/
│   │   └── chat.test.js
│   ├── node/
│   │   ├── state.test.js
│   │   ├── peerManager.test.js
│   │   └── heartbeatManager.test.js
│   ├── protocol/
│   │   ├── messageFactory.test.js
│   │   ├── lamportClock.test.js
│   │   ├── pendingQueue.test.js
│   │   ├── gossipEngine.test.js
│   │   └── ackManager.test.js
│   └── transport/
│       └── transport.test.js
├── transport/              # WebSocket connection layer
│   ├── connectionPool.js   # Outbound connection manager
│   ├── index.js            # Barrel file
│   ├── wsClient.js         # Outbound peer client (w/ reconnects)
│   └── wsServer.js         # Incoming peer server
├── utils/                  # Shared utility functions
│   ├── generateId.js       # UUID generation (legacy)
│   └── logger.js           # Logging utility
├── package.json            # Node.js dependencies and scripts
├── PROJECT_SUMMARY.md      # Detailed project summary
└── README.md               # Project entry documentation
```

## Key Components

### 1. Transport Layer (`transport/`)
- **`wsServer.js`**: Listens for incoming WebSocket connections, enforces the `HELLO` handshake, and drops malformed payloads.
- **`wsClient.js`**: Outbound client featuring exponential backoff reconnections and offline message queuing.
- **`connectionPool.js`**: Manages all active outbound `WSClient` instances, enforces `MAX_PEERS`, and provides a smart `broadcast` method with loopback prevention.

### 2. Protocol Layer (`protocol/`)
- **`schema.js`**: Defines the strict canonical JSDoc schema (`P2PMessage`) used to validate all messages in the network.
- **`messageFactory.js`**: Robust builder class generating schema-compliant messages (CHAT, ACK, HEARTBEAT, PEER_EXCHANGE) with proper UUIDs, TTLs, and Lamport timestamps.
- **`lamportClock.js`**: Implements logical time to establish causal ordering of events in a distributed system, ensuring `Time(A) < Time(B)` if A causes B.
- **`gossipEngine.js`**: The core "brain" of the network. It handles incoming messages, manages the seen-message cache (O(1) Set), decrements TTL, and forwards messages to a random subset of peers (`GOSSIP_FANOUT`).
- **`ackManager.js`**: Ensures reliable delivery for critical messages by tracking acknowledgments, managing retry timers, and emitting success/failure events.
- **`pendingQueue.js`**: A memory-safe FIFO buffer that stores messages for peers that are currently offline or connecting, flushing them once a connection is established.

### 3. Core Node Logic (`node/`)
- **`state.js`**: Centralized state store managing the node's internal state (peers, seen messages, logical clocks). Includes auto-cleanup logic to prevent memory leaks and enforces strict mutation patterns.
- **`peerManager.js`**: Orchestrates the peer lifecycle state machine (`CONNECTING → ACTIVE → SUSPECTED → DEAD`). It handles peer registration and ensures connections are properly initiated and terminated.
- **`heartbeatManager.js`**: Implements active failure detection using a "suspicion" mechanism. It sends periodic heartbeats to active peers and transitions nodes to suspected or dead states based on response latency.
- **`server.js`**: Orchestrates the WebSocket server for incoming peer connections.
- **`messageHandler.js`**: (Pending Migration) Implements the gossip logic at the node level, bridging the protocol engine and transport layers.
- **`discovery.js`**: (Planned) mDNS-based local network peer discovery.

### 4. Configuration (`config/`)
- **`default.js`**: Centralized, tunable constants for network behavior (e.g., `GOSSIP_FANOUT`, `MAX_TTL`, timeout intervals).

### 5. Client Interfaces (`client/`)
- **`cliClient.js`**: A terminal-based interface for user interaction (sending/receiving messages).
- **`webClient/`**: A planned browser-based interface (`index.html`, `app.js`) for a more visual chat experience.

## Data Flow (End-to-End)
1. **Initialization**: A node starts, initializes its WebSocket server via `server.js`, and prepares the `state`.
2. **Peer Connection**: The `peerManager` establishes connections with other peers discovered via `discovery.js`.
3. **Message Origination**: A user types a message in the `cliClient`. The client generates a unique ID for the message using `generateId`.
4. **Local Broadcast**: The local node sends the message to all peers currently stored in `state.peers`.
5. **Propagation (Gossip)**:
    - A receiving peer catches the message in `messageHandler`.
    - It checks if `seenMessages.has(messageId)`.
    - If new, it notifies the user and sends the message to its own connected peers (excluding the one that just sent it).
6. **Termination**: If a message reaches a node that has already processed it, the propagation for that specific branch stops, ensuring the network isn't flooded indefinitely.

## Algorithms & Problem Solving

The application employs specific algorithms and patterns to address the unique challenges of a decentralized network:

| Problem | Algorithm / Solution | Description |
| :--- | :--- | :--- |
| **Message Dissemination** | **Gossip (Epidemic) Protocol** | Ensures that messages reach all nodes in a decentralized network by having each node re-broadcast new messages to its neighbors. |
| **Infinite Loops** | **Deduplication (Seen-Message Cache)** | Prevents messages from circulating indefinitely by tracking unique message IDs in a local `Set` and discarding duplicates. |
| **Causal Ordering** | **Lamport Logical Clock** | Provides a partial ordering of events in a distributed system where physical clocks cannot be synchronized perfectly. |
| **Reliable Delivery** | **ACK & Retry Protocol** | Guarantees that critical control or data messages are received by peers through explicit acknowledgments and exponential backoff retries. |
| **Failure Detection** | **Suspicion-based Heartbeats** | Uses a multi-stage failure detector (Active -> Suspected -> Dead) to differentiate between transient network lag and permanent node failure. |
| **Peer Discovery** | **mDNS (Multicast DNS)** | (Planned) Solves the "zero-configuration" problem, allowing nodes to find each other on a local network without hardcoded IP addresses. |
| **Collision Resistance** | **UUID v4** | Uses a high-entropy 128-bit random identifier to ensure that messages generated by different peers have a negligible probability of sharing the same ID. |
| **Network Reliability** | **Peer Management Lifecycle** | Implements a robust state machine for peer connections, ensuring consistent network topology across the mesh. |

## Technical Stack
- **Runtime**: Node.js (ES Modules)
- **Communication Layer**: WebSockets (`ws`)
- **Data Persistence**: LevelDB (`level`)
- **Cryptography**: `sodium-native`
- **Peer Discovery**: `mdns-js`
- **Logging**: `pino`
- **Testing**: Native Node.js Test Runner (`node:test`)
- **ID Generation**: `uuid` v4

## Current Implementation Status
The project has recently undergone a major architectural restructuring into a production-grade modular layout. We have fully implemented and tested the **WebSocket Transport Layer** (with robust reconnections, handshakes, and limits), the **Protocol Layer** (including the core **Gossip Engine**, **Lamport Clock**, and **ACK Management**), and the **Core Node Logic** (including **Peer Lifecycle Management**, **Active Failure Detection**, and a centralized **State Store**). The system now supports reliable message propagation with causal ordering, deduplication, and resilient network topology management. The storage, security, and discovery layers are slated for upcoming implementation phases. An automated testing pipeline using the native Node.js test runner ensures reliability across all core components.
