# Use an official Node.js runtime as a parent image
# Slim is used for a small footprint while maintaining glibc compatibility for native modules
FROM node:20-slim

# Create application directory and set permissions
WORKDIR /usr/src/app

# Copy package.json and package-lock.json first to leverage Docker cache
COPY package*.json ./

# Install dependencies
RUN npm ci

# Copy the rest of the application code
COPY . .

# Create a data directory for persistent storage and ensure the 'node' user can write to it
RUN mkdir -p /usr/src/app/data && chown -R node:node /usr/src/app

# Switch to the non-root 'node' user for security
USER node

# Set environment variables
ENV PORT=8080
ENV PEER_ID=docker-node
ENV BOOTSTRAP=""
ENV DB_PATH=/usr/src/app/data

# Expose the default P2P port
EXPOSE 8080

# Healthcheck to ensure the process is running
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD ps aux | grep "node node/server.js" || exit 1

# Run the headless node server as the container entrypoint
CMD ["node", "node/server.js"]
