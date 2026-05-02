# Project Summary: p2p_app

## Objective
A decentralized peer-to-peer (P2P) chat application designed to allow users to communicate without a central server, using direct connections between peers.

## Architecture Overview
The application follows a distributed architecture where each "node" acts as both a client and a server. It uses a gossip-style message propagation mechanism to ensure messages reach all participants in the network.

## Directory Structure
```text
p2p_app/
├── client/                 # User interface components
├── config/                 # Network and app configurations
│   └── default.js          # Core network constants
├── metrics/                # Latency and delivery tracking
├── node/                   # Core P2P node logic (legacy, pending migration)
│   ├── discovery.js        # Peer discovery (mDNS)
│   ├── messageHandler.js   # Gossip protocol implementation
│   ├── peerManager.js      # Connection lifecycle management
│   ├── server.js           # WebSocket server entry point
│   └── state.js            # Node state (peers, seen messages)
├── protocol/               # Protocol definitions and factories
│   ├── schema.js           # Canonical JSDoc message schema
│   └── messageFactory.js   # Message builder for network payloads
├── security/               # Encryption and signing layer
├── storage/                # Persistence layer (LevelDB)
├── tests/                  # Native Node.js test suite
│   ├── e2e/
│   │   └── chat.test.js
│   ├── protocol/
│   │   └── messageFactory.test.js
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

### 3. Core Node Logic (`node/` - Migrating to `transport/` and `protocol/`)
- **`server.js`**: Orchestrates the WebSocket server for incoming peer connections.
- **`state.js`**: Manages the local state of the node, including the list of active peers (`Map`) and a cache of seen message IDs (`Set`) to prevent propagation loops.
- **`messageHandler.js`**: Implements the gossip protocol. When a message is received:
    - It parses the message and checks against the `seenMessages` set.
    - If new, it adds the ID to the set, logs the content, and broadcasts the message to all other active peers.
- **`discovery.js`**: (Planned) mDNS-based local network peer discovery to find peers automatically without manual IP entry.
- **`peerManager.js`**: (Skeletal) Handles the lifecycle of peer connections (connecting, disconnecting, and managing socket states).

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
| **Peer Discovery** | **mDNS (Multicast DNS)** | (Planned) Solves the "zero-configuration" problem, allowing nodes to find each other on a local network without hardcoded IP addresses. |
| **Collision Resistance** | **UUID v4** | Uses a high-entropy 128-bit random identifier to ensure that messages generated by different peers have a negligible probability of sharing the same ID. |
| **Network Reliability** | **Peer Management Lifecycle** | (Skeletal) Uses a connection-retry and state-monitoring algorithm to maintain a healthy mesh of active peer connections. |

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
The project has recently undergone a major architectural restructuring into a production-grade modular layout. We have fully implemented and tested the **WebSocket Transport Layer** (with robust reconnections, handshakes, and limits) and the **Protocol Layer** (with strict canonical schemas and message factories). The legacy node logic awaits final migration, while the storage, security, and discovery layers are slated for upcoming implementation phases. An automated testing pipeline using the native Node.js test runner ensures reliability across the `transport` and `protocol` components.
