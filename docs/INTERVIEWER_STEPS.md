# Interviewer Testing Guide
## "How to Test This Project — Step by Step"

> **No prior knowledge needed.** Just follow these steps in order.
> Everything runs automatically — you never need to understand the code.

---

## Prerequisites (One-Time Setup)

Install either of these — **pick one**:

| Option | What You Need |
|---|---|
| **Docker** (Easiest) | [Docker Desktop](https://www.docker.com/get-started) only |
| **Node.js** (Faster) | [Node.js v20+](https://nodejs.org) only |

Then clone the project:
```bash
git clone https://github.com/Rishi192004/p2p_app.git
cd p2p_app
```

---

## OPTION A — Full System Test (Docker, Recommended)

> This runs the ENTIRE distributed system: 3 P2P nodes + AI service + visualizer.

### Step 1 — Start everything
```bash
docker compose up
```
**What happens:** Docker automatically downloads the AI model, starts all services, and connects them together. Wait until you see all services say `healthy`.

> ⚠️ First time only: downloads ~700MB AI model. Takes 3–5 minutes.
> After that, restarts are instant.

### Step 2 — Open the visualizer
Open your browser → **http://localhost:5173**

You will see a live force-directed graph showing 3 nodes connected in a mesh.

### Step 3 — Check all services are alive

Open these URLs — each should return JSON:

| URL | Expected Response |
|---|---|
| http://localhost:8090/health | `{"status":"ok", "uptime": ...}` |
| http://localhost:8091/health | `{"status":"ok", "uptime": ...}` |
| http://localhost:8092/health | `{"status":"ok", "uptime": ...}` |
| http://localhost:8001/health | AI service health |

### Step 4 — Shut down
```bash
docker compose down
```

---

## OPTION B — Automated Tests (Node.js, Faster)

> Install dependencies once, then run any test below.

```bash
npm install
```

---

### TEST 1 — The Complete System Test ⭐ (Start Here)

```bash
npm run test:e2e
```

**What it does:** Automatically spins up 4 nodes, runs 12 test phases, shuts down.
**Time:** ~8 seconds.
**What to look for:**

```
╔══════════════════════════════════════════════════════════════╗
║  PHASE 3 — COMPLETE E2E SYSTEM TEST                          ║
╚══════════════════════════════════════════════════════════════╝

▶ PHASE 1 — Network Formation
▶ PHASE 2 — Topic Routing
▶ PHASE 3 — Multi-User Concurrent Messaging
...
  Duration     : 7.3s
  Passed       : 27
  Failed       : 0

  ✔  Network Formation
  ✔  Topic Routing
  ✔  Multi-User Messaging
  ✔  Data Integrity
  ✔  Causal Ordering
  ✔  Race Conditions
  ✔  AI Summarization
  ✔  Async Safety (Mutex)
  ✔  Partition Recovery
  ✔  Direct Messaging
  ✔  Security (Ed25519)
  ✔  Final Consistency

    ALL CHECKS PASSED — SYSTEM IS PRODUCTION VERIFIED
```

✅ **Pass = the entire system works correctly.**

---

### TEST 2 — Unit Test Suite

```bash
npm test
```

**What it does:** Runs 66 unit and integration tests.
**Time:** ~15 seconds.
**What to look for:**

```
pass: 66
fail: 0
```

✅ **Pass = all individual components are correct.**

---

### TEST 3 — Performance / Latency Audit

```bash
npm run test:performance
```

**What it does:** Measures how fast messages travel across 3 nodes (2 hops).
**Time:** ~15 seconds.
**What to look for:**

```
| Avg Latency  | ~1.5 ms   |
| p99 Latency  | ~8 ms     |
```

✅ **Pass = average < 5ms, p99 < 15ms. Test asserts this automatically.**

---

### TEST 4 — 50,000 Message Stress Test

```bash
npm run stress-test
```

**What it does:** Fires 50,000 messages, then kills a node, then revives it and verifies it catches up on everything it missed.
**Time:** ~60–90 seconds.
**What to look for:**

```
🚀 Ingest Rate         : 4288 msg/sec
🛡️ Data Loss           : 0.00%
💾 Persistence         : Verified (LevelDB)
🌊 Flow Control        : Verified (Adaptive)

50,000 MESSAGE STRESS TEST: COMPLETED SUCCESSFULLY
```

✅ **Pass = zero data loss at 4000+ messages/second.**

---

### TEST 5 — Interactive Live Showcase

```bash
npm run interview
```

**What it does:** A narrated, live terminal demo that proves 12+ system features one by one with real data — PoW, rate limiting, encryption, topic routing, partition recovery, AI summarization, etc.
**Time:** ~30 seconds.
**No assertions** — this is a visual showcase, not a pass/fail test.

---

## What Each Test Proves

| Test Command | What It Proves |
|---|---|
| `npm run test:e2e` | The whole system works end-to-end |
| `npm test` | Every individual module is correct (92.4% coverage) |
| `npm run test:performance` | System is fast enough for production (p99 < 15ms) |
| `npm run stress-test` | No data loss at scale, partition recovery works |
| `npm run interview` | All features demonstrated live |

---

## Recommended Order for an Interview Session

```
1. npm run test:e2e          ← Run this first (~8s, proves everything)
2. npm run interview          ← Watch the live demo (~30s)
3. npm test                   ← Show unit test coverage (~15s)
4. npm run test:performance   ← Show latency numbers (~15s)
5. npm run stress-test        ← If time allows (~90s, most impressive)
```

---

## Troubleshooting

| Problem | Fix |
|---|---|
| Port already in use | `docker compose down` or restart terminal |
| `npm install` fails | Make sure Node.js 20+ is installed |
| Docker model download stuck | Wait — first download is ~700MB |
| Test fails with timeout | Machine may be under load — rerun once |
