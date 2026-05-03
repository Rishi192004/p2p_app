# Dockerization Guide for the P2P Mesh

This document explains the Docker configuration added to this project and why it is a critical asset for demonstrating your skills in SDE-1 and ASDE interviews.

## What Was Added?

We added two key files to the root of the project:

### 1. `Dockerfile`
A Dockerfile is like a recipe for creating a virtual machine (a container) that only has exactly what your app needs to run.

**Key Technical Decisions:**
- **`FROM node:20-alpine`**: We used the "Alpine" version of Linux. It is incredibly small (around 5MB), which shows interviewers you care about minimizing image sizes and attack surfaces, a senior-level DevSecOps trait.
- **Native Bindings (`apk add make g++ python3`)**: Libraries like `libsodium` (for cryptography) and `leveldb` (for storage) use C++ under the hood. They must be compiled for the specific OS they run on. Installing these build tools inside the Dockerfile ensures the app successfully builds anywhere, bypassing the dreaded "It works on my machine" problem.
- **`CMD ["node", "node/server.js"]`**: The container runs the headless node orchestrator rather than the interactive CLI, making it perfect for background service execution.

### 2. `docker-compose.yml`
Docker Compose is an orchestration tool that lets you define and run multi-container applications.

**Key Technical Decisions:**
- **Simulating a Mesh**: The compose file defines three separate services: `node-alpha`, `node-beta`, and `node-gamma`. This simulates three distinct computers running your software.
- **Internal DNS**: Look at how `node-beta` connects to `node-alpha`: `BOOTSTRAP=ws://node-alpha:8080`. Docker automatically resolves `node-alpha` to the correct internal IP address. This demonstrates you understand container networking.
- **Volume Mapping**: `volumes: [ "./storage/docker-alpha:/usr/src/app/storage" ]`. This maps the internal LevelDB storage to your host machine. If you destroy the containers and recreate them, the chat history and keys survive. This proves you understand **stateful vs. stateless** container design.

## Why Interviewers Love This (The "Cheat Code")

When an interviewer reviews your code, they often want to see it run. 

**Without Docker:**
They have to install Node, run `npm install` (which might fail if they don't have C++ build tools on their Mac/Windows), open three terminal tabs, and manually type out environment variables for three different nodes. Most won't bother.

**With Docker:**
All they have to do is type **one command**:
```bash
docker-compose up --build
```
Instantly, a 3-node distributed system spins up, connects to itself, and starts printing logs.

### The Signal You Send:
1. **You understand Production Environments**: You know that code is eventually deployed to Linux containers (Kubernetes/AWS ECS), not run on laptops.
2. **You value Developer Experience (DX)**: You made it incredibly easy for other engineers to onboard and run your complex system.
3. **You can test Distributed Systems**: Spinning up a local mesh via Compose is exactly how Senior Engineers write integration tests for microservices.

## How to Test It Yourself

1. Ensure Docker Desktop is installed and running.
2. Open a terminal in the project root.
3. Run: `docker-compose up --build`
4. Watch the logs as `node-alpha` starts, and then `node-beta` and `node-gamma` connect to it and perform the Gossip HELLO handshakes.
5. To stop it, press `Ctrl+C` or run `docker-compose down`.
