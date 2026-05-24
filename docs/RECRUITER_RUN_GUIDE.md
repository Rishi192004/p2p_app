# P2P Gossip Mesh — One-Command Setup Guide

> Run the entire distributed P2P network, local AI, and visualizer with a single command on **any machine** (Windows, Linux, Mac).

---

## ⚡ Prerequisites

| Tool | Version | Install |
|---|---|---|
| Docker Desktop | 4.x + | [docker.com/get-started](https://www.docker.com/get-started) |
| Docker Compose | v2+ (bundled with Docker Desktop) | Included above |

**That's it.** No Node.js, Python, Ollama, or anything else needs to be installed locally.

---

## 🚀 Step 1 — Clone & Boot

```bash
git clone https://github.com/Rishi192004/p2p_app.git
cd p2p_app
docker compose up
```

> **First boot only**: Ollama will download the `llama3.2:1b` model (~700MB). This happens automatically and only once. The model is cached in a named volume for all future startups.

---

## 📊 Step 2 — What's Running

Once all containers are healthy, open these URLs in your browser:

| URL | What You'll See |
|---|---|
| [http://localhost:5173](http://localhost:5173) | 🌐 **Gossip Visualizer** — live force-directed topology graph, metrics panel, chaos controls |
| [http://localhost:8090/health](http://localhost:8090/health) | 💚 **Node Alpha** health status JSON |
| [http://localhost:8091/health](http://localhost:8091/health) | 💚 **Node Beta** health status JSON |
| [http://localhost:8092/health](http://localhost:8092/health) | 💚 **Node Gamma** health status JSON |
| [http://localhost:8001/health](http://localhost:8001/health) | 💚 **AI Service** health + model info |
| [http://localhost:11434/api/tags](http://localhost:11434/api/tags) | 🤖 **Ollama** available models list |
| [http://localhost:8090/metrics](http://localhost:8090/metrics) | 📈 **Node Alpha** raw JSON metrics |

---

## 🤖 Step 3 — Change the AI Model (Optional)

```bash
# 1. Copy the example config
cp .env.example .env

# 2. Edit .env and change OLLAMA_MODEL to any Ollama model:
#    llama3.2:1b   → fastest (~700MB)  ← default
#    gemma2:2b     → smarter (~1.6GB)
#    phi3:mini     → Microsoft (~2.3GB)
#    llama3.1:8b   → best quality (~4.7GB, needs 8GB RAM)

# 3. Restart with the new model
docker compose down
docker compose up
```

---

## 📋 Useful Commands

```bash
# Boot the entire stack
docker compose up

# Boot in the background (detached mode)
docker compose up -d

# Watch live logs for a specific node
docker compose logs -f node-alpha

# Watch all logs
docker compose logs -f

# Shut down (data is preserved in Docker volumes)
docker compose down

# Full reset — shuts down AND deletes all stored data and models
docker compose down -v

# Rebuild images after code changes
docker compose up --build

# Scale to more nodes (advanced)
docker compose up --scale node-gamma=3
```

---

## 🏗️ Architecture of What's Running

```
docker compose up
       │
       ├─→ ollama              (LLM server, port 11434)
       │       └─→ ollama-init (pulls model on first boot, then exits)
       │               └─→ ai-service       (FastAPI, port 8001)
       │                       └─→ node-alpha      (Genesis node, ports 8080/8090)
       │                               ├─→ node-beta   (Peer, ports 8081/8091)
       │                               └─→ node-gamma  (Peer, ports 8082/8092)
       │
       └─→ visualizer          (React + Nginx, port 5173)
```

**Every service has a health check.** Services only start once their dependencies are verified healthy — no race conditions.

---

## 📂 What Persists on Disk

Data is stored in **named Docker volumes** — they survive `docker compose down` but are wiped by `docker compose down -v`.

| Volume | Contents |
|---|---|
| `p2p-ollama-models` | Downloaded LLM model weights |
| `p2p-alpha-data` | Node Alpha's LevelDB message store |
| `p2p-beta-data` | Node Beta's LevelDB message store |
| `p2p-gamma-data` | Node Gamma's LevelDB message store |

---

## 🧪 Run Tests (Without Docker)

If you want to run the automated test suite locally:

```bash
# Requires Node.js 20+ installed locally
npm install
npm test                  # Full test suite (92%+ coverage)
npm run stress-test       # 50,000 message stress test
npm run test:performance  # p99 latency audit
npm run interview         # Interactive technical showcase
```
