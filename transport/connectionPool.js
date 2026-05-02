import pino from 'pino';
import { WSClient } from './wsClient.js';
import config from '../config/default.js';
import { EventEmitter } from 'events';

const logger = pino({ name: 'connectionPool' });

export class ConnectionPool extends EventEmitter {
    constructor(localPeerId, localPublicKey = null) {
        super();
        this.localPeerId = localPeerId;
        this.localPublicKey = localPublicKey;
        this.outboundConnections = new Map(); // Map<peerId, WSClient>
    }

    /**
     * Initiates a connection to a remote peer.
     * @param {string} host 
     * @param {number} port 
     * @param {string} peerId 
     */
    connect(host, port, peerId) {
        if (this.outboundConnections.has(peerId)) {
            logger.debug({ event: 'connection_exists', peerId }, 'Already connected or connecting to peer');
            return;
        }

        if (this.outboundConnections.size >= config.MAX_PEERS) {
            logger.warn({ event: 'max_peers_reached', peerId }, `Cannot connect to ${peerId}. Max peers (${config.MAX_PEERS}) reached.`);
            return;
        }

        const client = new WSClient(host, port, this.localPeerId, peerId, this.localPublicKey);
        this.outboundConnections.set(peerId, client);

        client.on('connected', () => {
            logger.info({ event: 'pool_peer_connected', peerId }, 'Peer added to active pool');
            this.emit('peer:connected', peerId);
        });

        client.on('message', (msg) => {
            this.emit('message:received', msg, peerId);
        });

        client.on('failed', () => {
            logger.error({ event: 'pool_peer_failed', peerId }, 'Peer connection permanently failed, removing from pool');
            this.outboundConnections.delete(peerId);
            this.emit('peer:failed', peerId);
        });

        client.on('disconnected', () => {
             // Client will try to reconnect automatically via wsClient logic.
             // We don't remove it from the pool until it emits 'failed'.
        });

        client.connect();
    }

    /**
     * Manually disconnects and removes a peer from the pool.
     * @param {string} peerId 
     */
    disconnect(peerId) {
        const client = this.outboundConnections.get(peerId);
        if (client) {
            client.disconnect();
            this.outboundConnections.delete(peerId);
            logger.info({ event: 'pool_peer_removed', peerId }, 'Peer manually removed from pool');
            this.emit('peer:disconnected', peerId);
        }
    }

    /**
     * Broadcasts a message to all active outbound connections.
     * @param {Object} message - The message object to send.
     * @param {string[]} excludePeerIds - Array of peerIds to skip (prevents immediate loopbacks).
     */
    broadcast(message, excludePeerIds = []) {
        const excludeSet = new Set(excludePeerIds);
        let broadcastCount = 0;

        for (const [peerId, client] of this.outboundConnections.entries()) {
            if (!excludeSet.has(peerId)) {
                client.send(message);
                broadcastCount++;
            }
        }

        logger.debug({ event: 'message_broadcasted', msgType: message.type, count: broadcastCount }, 'Message broadcasted to pool');
    }

    /**
     * Returns connection state of a specific peer
     * @param {string} peerId 
     * @returns {'CONNECTED' | 'CONNECTING' | 'DISCONNECTED' | 'UNKNOWN'}
     */
    getPeerState(peerId) {
        const client = this.outboundConnections.get(peerId);
        if (!client) return 'UNKNOWN';
        if (client.isConnected) return 'CONNECTED';
        if (client.ws && client.ws.readyState === 0) return 'CONNECTING'; // 0 = WebSocket.CONNECTING
        return 'DISCONNECTED';
    }
}

// === SYSTEM DESIGN NOTES ===
// Tradeoff: The ConnectionPool manages outbound clients but does not currently merge inbound connections
// (managed by wsServer) into a unified peer state. This means if Node A connects to Node B, and Node B 
// connects to Node A, two separate TCP sockets exist. This consumes extra sockets but drastically simplifies 
// routing and connection teardown logic (no need for complex NAT traversal or socket handoff protocols).
// What could go wrong at scale: If the node becomes highly popular, running out of file descriptors (ulimit) 
// or ephemeral ports is a major risk. The single-threaded Event Loop could also become a bottleneck when iterating 
// over a massive Map during high-frequency broadcasts.
// How to improve in production: Implement connection deduplication (if A connects to B, B detects the connection 
// and drops its own outbound attempt to A, reusing the inbound socket). Move to a clustered architecture using 
// Redis pub/sub backplanes if scaling horizontally across multiple CPU cores is required.
