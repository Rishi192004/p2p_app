import { EventEmitter } from 'events';
import config from '../config/default.js';
import collector from '../metrics/collector.js';

/**
 * Manages pending acknowledgments for critical messages to ensure reliable delivery.
 * 
 * Data Structure Choice: Map<messageId, Object> over Object because we are dynamically
 * adding/removing a large number of IDs (keys) and iterating or checking size might be needed.
 * Maps perform better for frequent additions and removals.
 */
export class AckManager extends EventEmitter {
    constructor(connectionPool, lamportClock) {
        super();
        this.connectionPool = connectionPool;
        this.lamportClock = lamportClock;
        this.pendingAcks = new Map();
    }

    /**
     * Sends a message to an array of peers and tracks it for acknowledgments.
     * 
     * @param {Object} message 
     * @param {string[]} peerIds 
     */
    sendWithAck(message, peerIds) {
        // Ensure message has a lamport timestamp before sending
        if (!message.lamportTimestamp) {
            message.lamportTimestamp = this.lamportClock.tick();
        }

        const pendingEntry = {
            message,
            attempts: 1,
            peers: new Set(peerIds), // Set over Array: O(1) removal when an ACK is received
            startTime: Date.now(),
            timer: null
        };

        this.pendingAcks.set(message.id, pendingEntry);

        // Send to each peer
        this._transmit(message, peerIds);
        this._startTimer(message.id);
    }

    _transmit(message, peerIds) {
        for (const peerId of peerIds) {
            const client = this.connectionPool.outboundConnections.get(peerId);
            if (client && client.isConnected) {
                client.send(message);
            } else {
                // If direct send isn't available on the client object, fallback to broadcast 
                // excluding everyone else.
                const allPeers = Array.from(this.connectionPool.outboundConnections.keys());
                const excludePeers = allPeers.filter(id => id !== peerId);
                this.connectionPool.broadcast(message, excludePeers);
            }
        }
    }

    _startTimer(messageId) {
        const entry = this.pendingAcks.get(messageId);
        if (!entry) return;

        entry.timer = setTimeout(() => {
            this._handleTimeout(messageId);
        }, config.ACK_TIMEOUT_MS);
    }

    _handleTimeout(messageId) {
        const entry = this.pendingAcks.get(messageId);
        if (!entry) return;

        if (entry.attempts >= config.MAX_RETRY_ATTEMPTS) {
            // Failed
            this.pendingAcks.delete(messageId);
            collector.increment('delivery_failed_total');
            this.emit('delivery:failed', { messageId, failedPeers: Array.from(entry.peers) });
        } else {
            // Retry
            entry.attempts++;
            this._transmit(entry.message, Array.from(entry.peers));
            this._startTimer(messageId);
        }
    }

    /**
     * Processes an incoming ACK message.
     * 
     * @param {Object} ackMessage 
     */
    receiveAck(ackMessage) {
        try {
            const payload = JSON.parse(ackMessage.payload);
            const messageId = payload.ackId;
            const peerId = ackMessage.sender;

            const entry = this.pendingAcks.get(messageId);
            if (entry) {
                entry.peers.delete(peerId);

                if (entry.peers.size === 0) {
                    // Everyone acknowledged
                    clearTimeout(entry.timer);
                    const latency = Date.now() - entry.startTime;
                    collector.record('message_latency_ms', latency);
                    collector.increment('delivery_confirmed_total');
                    this.pendingAcks.delete(messageId);
                    this.emit('delivery:confirmed', messageId);
                }
            }
        } catch (err) {
            // Invalid ack payload, ignore
        }
    }
}
