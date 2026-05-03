# Use an official Node.js runtime as a parent image
# Alpine is used for a significantly smaller image footprint
FROM node:20-alpine

# Set the working directory in the container
WORKDIR /usr/src/app

# Install native build dependencies required by libsodium and leveldb
# (These modules need to compile C++ code during npm install)
RUN apk add --no-cache python3 make g++ 

# Copy package.json and package-lock.json first to leverage Docker cache
COPY package*.json ./

# Install dependencies (ci ensures clean install from lockfile)
RUN npm ci

# Copy the rest of the application code
COPY . .

# Set default environment variables
ENV PORT=8080
ENV PEER_ID=docker-node
ENV BOOTSTRAP=""

# Expose the default port
EXPOSE 8080

# Run the headless node server as the container entrypoint
CMD ["node", "node/server.js"]
