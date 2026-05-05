# 🐛 Debugging Archive: Engineering Challenges & Resolutions

This document chronicles the specific bugs, race conditions, and architectural hurdles encountered during the development of the `p2p_app`. For a senior engineer, these entries demonstrate technical troubleshooting, system design reasoning, and a "test-first" mindset.

---

## 1. Distributed Systems & Protocol Bugs

### Bug #101: The "Broadcast Storm" (Infinite Gossip Loops)
*   **Symptom**: Network saturation and 100% CPU usage within seconds of the first message.
*   **Root Cause**: The `seenMessages` cache was using message content for deduplication. If two nodes forwarded the same message with slightly different metadata (like a local `receivedAt` timestamp), the deduplication failed, causing an exponential broadcast loop.
*   **Detection Method**: Observed a massive spike in outbound network traffic and CPU usage via `htop` immediately after a single message was sent. The logs showed the same `messageId` being processed thousands of times per second.
*   **Resolution**: 
    *   Implemented a unique `messageId` (hash of the sender + payload + originator timestamp).
    *   Changed the `seenMessages` store to an LRU cache with an $O(1)$ lookup complexity.
    *   Strictly enforced a **TTL (Time-to-Live)** of 10 hops to bound any potential misrouted traffic.

### Bug #102: Lamport Clock Inversion
*   **Symptom**: Messages arriving "from the future" or "out of order" during high-throughput tests.
*   **Root Cause**: The local clock was being incremented *after* sending the message. This meant a node could send multiple messages with the same timestamp before its internal counter updated.
*   **Detection Method**: Automated E2E tests for message ordering failed. When inspecting the `MessageStore` logs, multiple messages from the same peer had identical Lamport timestamps, making deterministic ordering impossible.
*   **Resolution**: 
    *   Moved to a **"Pre-Increment"** strategy: `clock = max(local, remote) + 1` happens *immediately* upon message creation or reception.
    *   Verified the fix with a unit test that simulates 1,000 concurrent message arrivals.

---

## 2. Networking & Handshake Bugs

### Bug #201: The "Double Socket" Handshake Race
*   **Symptom**: Redundant connections. Node A would have an outbound socket to Node B, AND Node B would have an outbound socket to Node A simultaneously.
*   **Root Cause**: Both nodes initiated connections at the same time during mDNS discovery. Neither node knew the other was already connecting.
*   **Detection Method**: Noticed duplicate "Peer Connected" events for the same `peerId` in the console. Using `netstat`, I confirmed there were two active TCP connections between the same two IP addresses on different ports.
*   **Resolution**: 
    *   Implemented a **Deterministic Tie-breaker**. 
    *   Logic: `if (localPeerId < remotePeerId) { keepOutbound(); closeInbound(); }`. 
    *   This ensures only one stable, full-duplex connection exists between any two peers, regardless of who initiated the dial.

### Bug #202: WebSocket "Silent Drops"
*   **Symptom**: Peers remained in the `ACTIVE` pool despite being unreachable.
*   **Root Cause**: TCP timeouts are often too long (minutes) for mobile or flaky networks. The node thought the socket was open, but no data was flowing.
*   **Detection Method**: During "Chaos Tests" where I manually disabled the network interface on one node, the other nodes still listed it as `ACTIVE` for over 2 minutes, attempting (and failing) to gossip messages to a dead socket.
*   **Resolution**: 
    *   Implemented an application-level **Heartbeat (Ping/Pong)** mechanism.
    *   Integrated a **Suspicion Machine**: A node is marked `SUSPECTED` after 2 missed pings and `DEAD` after 4.

---

## 3. Security & Cryptographic Bugs

### Bug #301: Buffer vs. Hex Serialization
*   **Symptom**: All gossip messages rejected with `AUTH_FAILURE` during multi-node tests, despite working in unit tests.
*   **Root Cause**: `sodium-native` (libsodium) requires keys as `Uint8Array/Buffer`. When sending messages over WebSockets, keys were serialized to JSON (converting them to `[1, 2, 3...]` arrays or Hex strings). On the receiving end, the `verify()` function was passing the raw Hex string instead of re-hydrating the Buffer.
*   **Detection Method**: Integration tests between two real nodes failed, while unit tests with mock Buffers passed. Added verbose logging to the `SecurityManager` which revealed that `typeof signature` was `string` in the real network but `object` (Buffer) in the unit tests.
*   **Resolution**: 
    *   Created a centralized `Serialization` utility.
    *   Standardized all wire-traffic to use **Hex encoding** for keys/signatures, with strict `Buffer.from(key, 'hex')` conversion before any cryptographic operation.

### Bug #302: Nonce Reuse Vulnerability
*   **Symptom**: Security audit identified a risk in the `Encryptor` module.
*   **Root Cause**: Using a static or predictable nonce for XSalsa20-Poly1305 encryption.
*   **Detection Method**: Conducted a manual security audit of the `security/encryptor.js` module. Recognized that the `encrypt` function was missing a random initialization vector (IV/Nonce), which is a "Top 10" cryptographic vulnerability.
*   **Resolution**: 
    *   Migrated to **Random Nonces** for every message.
    *   Appended the 24-byte nonce to the beginning of the ciphertext for transport, ensuring the receiver can decrypt without a pre-shared nonce.

---

## 4. Storage & Infrastructure Bugs

### Bug #401: LevelDB LOCK Contention
*   **Symptom**: Docker containers failing to start with `OpenError: IO error: lock data/LOCK: Resource temporarily unavailable`.
*   **Root Cause**: Multiple instances were trying to use the same default `./data` directory. LevelDB enforces a single-process lock to prevent database corruption.
*   **Detection Method**: Docker containers were stuck in a `CrashLoopBackOff` state. Using `docker logs <container_id>`, I found the specific LevelDB `IO error: lock` message.
*   **Resolution**: 
    *   Dynamic path allocation: The `MessageStore` now initializes paths based on the `peerId` (e.g., `./data/peer_<ID>/`).
    *   Updated `docker-compose.yml` to map unique volumes to each container.

### Bug #402: Sync Manager "Flood"
*   **Symptom**: Nodes crashing or disconnecting immediately after recovering from a network partition.
*   **Root Cause**: Upon re-connection, the `SyncManager` would try to push 5,000 missed messages into the WebSocket buffer at once, causing **Buffer Bloat** and triggering the rate-limiter on the receiving peer.
*   **Detection Method**: Noticed that nodes would successfully reconnect after a long partition, but would be immediately "Banned" by their peers. The `RateLimiter` logs showed 5,000 requests arriving in a single millisecond, exceeding the 20-message burst capacity.
*   **Resolution**: 
    *   Implemented **Delta Paging**.
    *   Messages are now synced in batches of 50 with a 100ms "cool-down" between batches to allow the transport layer to breathe and the receiver to process.

---

## Summary of Lessons Learned
1.  **Distributed systems are non-deterministic**: If it *can* happen at the same time, it *will* (see Bug #201).
2.  **Clock synchronization is a lie**: Trust logical counters (Lamport), not system time (see Bug #102).
3.  **Backpressure is mandatory**: Sending data is easy; ensuring the receiver can handle it is the real challenge (see Bug #402).
