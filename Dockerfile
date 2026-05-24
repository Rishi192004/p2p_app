# =============================================================================
# Multi-Stage Dockerfile — P2P Gossip Node (Node.js 20)
# =============================================================================
# Stage 1: Install ONLY production dependencies in an isolated layer.
# This keeps native binaries (sodium-native, leveldb) built for Linux
# and prevents host node_modules from leaking into the image.
# =============================================================================

FROM node:20-slim AS deps

WORKDIR /usr/src/app

# Copy manifests first to leverage Docker layer cache.
# npm ci will only re-run if package-lock.json changes.
COPY package*.json ./

# Install production dependencies only.
# --ignore-scripts is NOT used here because sodium-native and level
# require post-install scripts to compile their native bindings.
RUN npm ci --omit=dev

# =============================================================================
# Stage 2: Final runtime image — lean and non-root.
# =============================================================================

FROM node:20-slim AS final

WORKDIR /usr/src/app

# Copy pre-built node_modules from the deps stage (Linux binaries only)
COPY --from=deps /usr/src/app/node_modules ./node_modules

# Copy application source code (see .dockerignore for exclusions)
COPY . .

# Create a dedicated data directory for LevelDB persistent storage.
# This is separate from the source code to avoid volume mount collisions.
RUN mkdir -p /usr/src/app/data && chown -R node:node /usr/src/app

# Switch to the non-root 'node' user for security.
USER node

# === Environment Defaults (overridden by docker-compose) ===
ENV NODE_ENV=production
ENV PORT=8080
ENV PEER_ID=docker-node
ENV BOOTSTRAP=""
ENV DB_PATH=/usr/src/app/data
ENV AI_SERVICE_URL=http://ai-service:8001

# Expose P2P WebSocket port and metrics HTTP port
EXPOSE 8080
EXPOSE 8090

# Health check using the real /health HTTP endpoint on the metrics server.
# Much more reliable than checking process list with 'ps aux'.
# start-period gives the node time to initialize LevelDB and connect to peers.
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=5 \
  CMD node -e "require('http').get('http://localhost:' + (parseInt(process.env.PORT || 8080) + 10) + '/health', r => r.statusCode === 200 ? process.exit(0) : process.exit(1)).on('error', () => process.exit(1))"

CMD ["node", "node/server.js"]
