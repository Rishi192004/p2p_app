# =============================================================================
# Multi-Stage Dockerfile — Gossip Visualizer (React + Vite → Nginx)
# =============================================================================
# Stage 1: Builder — compile the React app into a static production bundle.
# =============================================================================

FROM node:20-slim AS builder

WORKDIR /app

# Cache dependencies separately from source
COPY package*.json ./
RUN npm ci

# Copy source and build the production bundle
COPY . .
RUN npm run build

# =============================================================================
# Stage 2: Final — serve the static bundle with Nginx (4MB image vs 400MB Node)
# =============================================================================

FROM nginx:1.27-alpine AS final

# Remove default nginx content
RUN rm -rf /usr/share/nginx/html/*

# Copy the compiled Vite build output into nginx's serve directory
COPY --from=builder /app/dist /usr/share/nginx/html

# Copy custom nginx config (SPA fallback + compression)
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

# Nginx has its own built-in health mechanism; simple curl check
HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:80 || exit 1

CMD ["nginx", "-g", "daemon off;"]
