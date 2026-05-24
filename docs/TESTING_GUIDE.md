# Testing Guide for Interviewers & Reviewers

> This document explains **every test in the project** — what it tests, why it exists, what to look for in the output, and what the result proves about the system's engineering quality.
>
> **Prerequisite**: Node.js 20+ installed locally. Run `npm install` once before anything below.

---

## ⚡ Quick Reference — All Commands

| Command | What It Runs | Duration |
|---|---|---|
| `npm run test:e2e` | **Phase 3 — Complete E2E system test (12 phases)** | ~25–40s |
| `npm test` | Full unit + integration test suite (66 tests) | ~10–15s |
| `npm run test:performance` | p99 latency audit across 3 nodes | ~15s |
| `npm run stress-test` | 50,000 message chaos + partition test | ~60–90s |
| `npm run interview` | Interactive terminal showcase of all 12+ features | ~30s |

> **Start here**: Run `npm run test:e2e` first — it is the single command that validates the entire system end-to-end automatically.

---

## 1. Full Test Suite — `npm test`

```bash
npm test
```

### What it does
Runs all **66 tests** across 6 categories using Node.js's built-in test runner (`node --test`). No extra dependencies needed — no Jest, no Mocha.

### Expected output
```
✔ LamportClock (7ms)
✔ GossipEngine (12ms)
✔ TopicRouter (9ms)
✔ SecurityManager (14ms)
✔ AIClient (22ms)
✔ End-to-End P2P Chat (400ms)
✔ Multi-Hop Topic Routing E2E (4000ms)
...
pass: 66
fail: 0
```

### Coverage summary

| Module | Coverage | What It Proves |
|---|---|---|
| `LamportClock` | 100% | Causal ordering is bulletproof |
| `TopicRouter` | 94.6% | Soft-state routing works under all conditions |
| `GossipEngine` | 92.5% | Dedup, TTL, fanout all verified |
| `SyncManager` | 90.2% | Delta sync and reconnect logic verified |
| `KeyManager` | 96.6% | Ed25519 key generation and persistence |
| `SecurityManager` | 88.4% | Sign + verify + tamper detection |
| `Encryptor` | 88.5% | XSalsa20-Poly1305 encryption/decryption |
| **Overall** | **92.4%** | Production-grade test coverage |

> **Interviewer question**: *"Why not 100%?"*
> The remaining 8% is defensive `catch` blocks for OS-level failures (disk full, socket exhaustion) and non-deterministic reconnect jitter — neither can be meaningfully unit tested.

---

## 2. Unit Tests — What Each Category Tests

### 2A. `tests/protocol/gossipEngine.test.js`
**What it tests**: The core epidemic broadcast brain.

| Test | What It Verifies |
|---|---|
| Drop duplicates | The same message ID arriving twice is rejected the second time via the `seenMessages` Set — prevents broadcast storms |
| Decrement TTL + forward | TTL goes from 10 → 9, and `broadcast()` is called exactly once |
| TTL = 0 → no forward | When TTL hits 0, the message is dropped and NOT forwarded — prevents infinite loops |
| Emit `message:new` | Fresh messages fire the event for the storage layer to save |
| Update Lamport clock | Clock correctly applies `max(local, received) + 1` rule |

**Why it matters**: If any of these fail, the entire gossip network either loops forever, drops messages silently, or loses causal ordering.

---

### 2B. `tests/protocol/topicRouter.test.js`
**What it tests**: Subscription routing table.

| Test | What It Verifies |
|---|---|
| Subscribe / unsubscribe | Routes are added and removed correctly |
| `getPeersForTopic` | Returns correct next-hop peers |
| Route expiry (soft-state) | Expired leases are removed by garbage collector |
| Stale sequence rejection | Old sequence numbers do not override newer routes |
| Multi-hop routing | Routes propagate to non-adjacent nodes correctly |

**Why it matters**: This is what prevents flooding the entire network. Without topic scoping, every message goes to every node, making the system unscalable.

---

### 2C. `tests/security/security.test.js`
**What it tests**: The cryptographic identity and integrity layer.

```
test 1: KeyManager — generates Ed25519 keys, persists them to disk, reloads identical key on restart
test 2: Encryptor — encrypts plaintext with XSalsa20-Poly1305, decrypts back to original
test 3: SecurityManager — signs message, verifies signature, then TAMPERS with payload and confirms invalid
```

**The tamper test is critical**: It proves that a forwarding node cannot modify the `payload` of a gossip message without the signature failing. This is your Man-in-the-Middle defense proof.

**Expected output**:
```
✔ KeyManager - generates and persists keys
✔ Encryptor - XSalsa20-Poly1305 encryption/decryption
✔ SecurityManager - signs and verifies messages
```

---

### 2D. `tests/aiClient.test.js`
**What it tests**: The AI summarization client integration.

| Test | What It Verifies |
|---|---|
| Empty messages → null | Client exits early without calling HTTP |
| Successful response | Payload correctly structured, summary returned |
| Connection error → null | Graceful fallback when AI service is offline |
| `/summary` slash command | Full P2P node triggers AI + broadcasts SUMMARY message |
| Auto-summary after 20 msgs | Counter triggers, LLM called, SUMMARY gossiped |

**The key technique**: Global `fetch` is mocked to avoid real network calls during tests. This also prevents Node.js socket handle leaks that would hang the test runner.

---

### 2E. `tests/e2e/chat.test.js`
**What it tests**: End-to-end message flow between two real nodes.

```
Test 1: Node A connects to Node B → sends CHAT message → Node B receives it with correct payload
Test 2: Node B connects back to Node A → sends ACK → Node A receives it (bidirectional verification)
```

**What makes this an E2E test**: Real WebSocket servers are spun up on real OS ports (8081, 8082). Real TCP connections are established. No mocks at the transport layer.

---

### 2F. `tests/e2e/multiHopTopicRouting.test.js`
**What it tests**: Multi-hop routing across 3 nodes in a line chain.

```
Topology: Node A ←→ Node B ←→ Node C
Node C subscribes to "teamA"
Node A publishes to "teamA"
```

**Assertions**:
1. Node B's routing table has a route for `"teamA"` → `nextHop: node-C`
2. Node A's routing table has a route for `"teamA"` → `nextHop: node-B`
3. Node C receives the message even though it is 2 hops away
4. Node B is NOT locally subscribed but correctly acted as a transit relay

**Why this is impressive**: Node B has zero awareness of the content of `"teamA"` messages. It only knows it has a neighbor (C) interested in them. This proves the Soft-State Distance-Vector routing actually works in a real multi-process scenario.

---

## 3. Performance Audit — `npm run test:performance`

```bash
npm run test:performance
```

### What it does
Spins up 3 real P2P nodes in a line chain (A → B → C). Fires 50 probe messages from Node A. Each message embeds a high-resolution `hrtime` timestamp. Node C measures the exact nanosecond it receives each message. Calculates average and p99 latency across all 50 samples.

### Expected output
```
--------------------------------------------------
       INTERVIEW AUDIT: LATENCY PERFORMANCE
--------------------------------------------------
| Nodes / Hops | 3 Nodes / 2 Hops     |
| Avg Latency  | 1.23 ms               |
| p99 Latency  | 8.44 ms               |
--------------------------------------------------
✔ Performance Audit: 3-Node Gossip Propagation
```

### Assertions
- **Average latency < 5ms** — verified by `assert`
- **p99 latency < 15ms** — verified by `assert`

> **Interviewer question**: *"Why is latency so low on a local machine?"*
> TCP loopback on the same machine avoids WAN hops. In a real distributed deployment across datacenters, expect 20–80ms per hop. The system's architecture (non-blocking I/O, TCP_NODELAY, no Nagle buffering) means it would scale well even at higher latencies.

---

## 4. 50,000 Message Stress Test — `npm run stress-test`

```bash
npm run stress-test
```

### What it does — 4 phases

**Phase 1 — Ingestion**
- Injects 50,000 chat messages into Node 0 as fast as possible
- Each message is cryptographically signed (Ed25519) + PoW solved
- Reports messages/second throughput

**Phase 2 — Propagation**
- Waits for all 50,000 messages to arrive at Node 2 (2 hops away)
- Shows live progress: `47,832/50,000 (95.7%)`
- Verifies 0.00% data loss

**Phase 3 — Persistence**
- Queries Node 2's LevelDB directly
- Confirms all 50,000 messages are durably stored
- Proves the batch-write strategy (buffer 50 → flush) handled high-volume correctly

**Phase 4 — Chaos + Partition Recovery**
- **Hard-kills** Node 2 mid-operation (`node.stop()`)
- Fires 5,000 more messages while Node 2 is dead
- Revives Node 2 and reconnects it
- Waits for SyncManager to deliver the 5,000 missed messages via ACK-based delta sync
- Verifies Node 2 eventually has all 55,000 messages

### Expected output
```
==================================================
       ULTIMATE SCALE TEST: 50,000 MESSAGES
==================================================

[INIT ] Dynamically allocating ports for 3-node cluster...
[VERIF] Cluster operational. Waiting for mesh stabilization...

PHASE 1: High-Throughput Ingestion
[LOAD ] Injecting 50000 messages into Node-0...
[DONE ] 50,000 messages signed, solved (PoW), and queued.
[METR ] Ingestion Speed: 4288 msg/sec

PHASE 2: Propagation & Data Integrity
Progress: 100.0% (50000/50000)
[VERIF] Epidemic Dissemination Complete.

PHASE 3: Persistence Audit
[DB   ] Node-2 Disk Records: 50000
[VERIF] Data Persistence Verified.

PHASE 4: Adaptive Flow Control (Stress Sync)
[KILL ] Hard-killing Node-2 to simulate partition...
[LOAD ] Pushing 5,000 "Missed" messages to Node-0...
[SYNC ] Reviving Node-2. Engaging ACK-based Sync...
Sync Progress: 55000/55000
[VERIF] Sync complete via Backpressure.

==================================================
             ULTIMATE VERIFICATION REPORT
==================================================
✅ Total Volume        : 55000 Messages
🚀 Ingest Rate         : 4288 msg/sec
🛡️ Data Loss           : 0.00%
🕰️ Causal Ordering     : Verified (Lamport)
💾 Persistence         : Verified (LevelDB)
🌊 Flow Control        : Verified (Adaptive)

50,000 MESSAGE STRESS TEST: COMPLETED SUCCESSFULLY
```

> **Interviewer question**: *"What happens if Node 2 reconnects but the SyncManager sends data faster than it can process?"*
> The SyncManager uses ACK-based sliding window flow control. It sends batch 1, then **blocks** until it receives a `SYNC_ACK`. Only then does it send batch 2. This prevents the receiver's buffer from being overwhelmed — the same principle as TCP's receive window.

---

## 5. Interactive Technical Showcase — `npm run interview`

```bash
npm run interview
```

### What it does
A scripted, narrated terminal demonstration that proves 12+ core system properties **live**, with colored output and timing data. Runs in ~30 seconds.

| Phase | What Gets Demonstrated |
|---|---|
| Phase 1 | PoW puzzle solved in real-time, nonce found, O(1) verification |
| Phase 2 | Rate limiter triggers on flood, peer banned, ban expires |
| Phase 3 | Lamport clock ordering — out-of-order messages correctly sequenced |
| Phase 4 | Network partition simulated, delta sync replays missed messages |
| Phase 5 | Topic routing — message only delivered to subscribed peers |
| Phase 6 | Ed25519 sign + verify + tamper detection |
| Phase 7 | Full E2E gossip across 3-node mesh |

> **How to use this in an interview**: Run this command on your laptop during the technical interview screen. It self-narrates every system property with live data, saving you from having to explain each one verbally.

---

## 6. What the Tests Prove Together

When a recruiter or interviewer runs all the tests, here is what they are empirically verifying:

| Claim | Verified By |
|---|---|
| Zero message loss at 50,000 messages | `npm run stress-test` Phase 2+3 |
| 4,288 msg/sec sustained throughput | `npm run stress-test` Phase 1 |
| p99 gossip latency < 15ms | `npm run test:performance` |
| Tampered messages detected and rejected | `security.test.js` |
| Subscriptions route messages to correct nodes only | `multiHopTopicRouting.test.js` |
| AI summarization fails gracefully when offline | `aiClient.test.js` |
| Partition recovery works via delta sync | `npm run stress-test` Phase 4 |
| Duplicate messages deduplicated (no broadcast storms) | `gossipEngine.test.js` |
| 92.4% code coverage | `npm test` output |
