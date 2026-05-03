# 🐳 Dockerization & Orchestration Guide

This guide documents the production-grade Docker architecture of the P2P Gossip Mesh. It highlights key engineering decisions and "Lessons Learned" that demonstrate systems-level proficiency for SDE/ASDE interviews.

---

## 🏗️ The Mesh Architecture in Docker

In a production distributed system, we rarely run nodes on a single host. Docker Compose allows us to simulate a **multi-node network topology** with isolated environments:

- **Service Isolation**: Each node (`node-alpha`, `node-beta`, etc.) runs in its own container with a unique IP address.
- **Internal Networking**: Nodes use Docker's internal DNS. `node-beta` connects to `node-alpha` via `ws://node-alpha:8080`, mimicking how services talk in a Kubernetes cluster.
- **Persistent State**: Databases are stored in host-mounted volumes. This separates the **stateless** application code from the **stateful** LevelDB data.

---

## 🛠️ Production Engineering Decisions

### 1. Base Image: `node:20-slim` vs `alpine`
Initially, the project used `alpine` for its small size. However, we shifted to `slim` for **production reliability**:
- **glibc Compatibility**: Native modules like `sodium-native` (cryptography) and `level` (storage) require `glibc`. Alpine uses `musl`, which can lead to binary incompatibility and "Module Not Found" errors.
- **Stability**: `slim` provides a balance of a small footprint while maintaining the standard Debian environment used in most production cloud deployments.

### 2. Multi-Stage Build Mentality
While the current Dockerfile is single-stage for simplicity, it follows **caching best practices**:
- `COPY package*.json ./` is run before copying the rest of the code. This ensures that `npm ci` is only re-run if dependencies change, drastically speeding up build times.

### 3. Context Isolation (`.dockerignore`)
A clean `.dockerignore` is mandatory for production. We isolate:
- `node_modules`: Prevents local host binaries (e.g., Windows) from overwriting container binaries (Linux).
- `storage`: Ensures local dev databases don't bloat the production image.

---

## 🎓 Engineering "Lessons Learned" (The Pitfalls)

Every senior engineer has stories of broken deployments. Below are the specific "Gotchas" we resolved, which are excellent talking points for an interview:

### ⚠️ Pitfall: The Volume Collision
**The Mistake**: Initially mounting the database volume directly to the `storage/` directory.
**The Impact**: The `storage/` directory also contained source code (`messageStore.js`). Mounting a volume there deleted the source code inside the container, causing a crash.
**The Fix**: Decoupled the code from the data. The application now uses a dedicated `/usr/src/app/data` directory for persistent storage, passed via the `DB_PATH` environment variable.

### ⚠️ Pitfall: Native Binary Mismatch
**The Mistake**: Using an Alpine-based image without building native dependencies from source inside the container.
**The Impact**: Cryptographic libraries failed to load because the container was looking for Linux-compatible binaries while the host (Windows) provided incompatible ones.
**The Fix**: Implemented a `.dockerignore` to prevent host-to-container leakage and switched to a `glibc` compatible base image (`slim`).

---

## 🚀 Operating the System

### 1. Boot the entire Mesh
```bash
docker-compose up --build
```

### 2. Scale or View Logs
To view logs for a specific node in real-time:
```bash
docker-compose logs -f node-alpha
```

### 3. Clean Shutdown
```bash
docker-compose down
```
*Note: Your data persists in the `./data` directory on your host machine even after shutdown.*
