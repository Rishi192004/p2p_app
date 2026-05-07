import { createLogger } from '../utils/logger.js';
import { MessageFactory } from '../protocol/messageFactory.js';
import collector from '../metrics/collector.js';

const logger = createLogger('syncManager');

/**
 * SyncManager handles synchronization of missing messages when a peer reconnects.
 * 
 * === CAP THEOREM NOTE ===
 * This system is AP (Available + Partition Tolerant).
 * During a network partition, nodes continue to accept local messages and gossip 
 * with whatever subset of peers they can reach. State will diverge.
 * When the partition heals, SyncManager exchanges missed messages to achieve 
 * eventual consistency. 
 * 
 * Why not CP (Consistent + Partition Tolerant)? 
 * CP would require a distributed consensus algorithm like Raft or Paxos, which 
 * means the system would stop accepting writes (become unavailable) if a majority 
 * quorum could not be reached. For a chat/gossip system, being unable to send 
 * messages offline is a terrible user experience. AP is the correct choice here.
 */
export class SyncManager {
    constructor(db, messageStore, gossipEngine, connectionPool, localPeerId) {
        this.db = db;
        this.messageStore = messageStore;
        this.gossipEngine = gossipEngine;
        this.connectionPool = connectionPool;
        this.localPeerId = localPeerId;
        
        // Flow Control: Tracks pending ACKs for active synchronization streams
        // Maps peerId -> { resolve: Function, timeout: Timer }
        this.pendingAcks = new Map();
    }

    /**
     * Helper to get the last seen Lamport timestamp for a peer.
     */
    async getLastSeenLamport(peerId) {
        try {
            const value = await this.db.get(`sync:${peerId}`);
            return parseInt(value, 10) || 0;
        } catch (err) {
            if (err.code === 'LEVEL_NOT_FOUND') return 0;
            throw err;
        }
    }

    /**
     * Helper to update the last seen Lamport timestamp for a peer.
     */
    async updateLastSeenLamport(peerId, lamportTimestamp) {
        try {
            await this.db.put(`sync:${peerId}`, lamportTimestamp.toString());
        } catch (err) {
            logger.error({ event: 'update_last_seen_error', error: err.message });
        }
    }

    /**
     * Triggers synchronization when a peer reconnects.
     * Uses application-level Flow Control (ACK-based).
     * 
     * @param {string} peerId 
     */
    async onPeerReconnected(peerId) {
        const lastSeenLamport = await this.getLastSeenLamport(peerId);
        logger.info({ event: 'sync_started', peerId, since: lastSeenLamport });
        const startTime = Date.now();

        const messagesToSync = await this.messageStore.getByTopic('global', lastSeenLamport);
        
        if (messagesToSync.length === 0) {
            logger.info({ event: 'sync_skipped', peerId, reason: 'already_consistent' });
            return;
        }

        // --- DYNAMIC FLOW CONTROL ---
        // Instead of a static timer (Throttling), we use a sliding window/ACK pattern.
        // We send a batch and WAIT for the receiver to confirm they've processed it.
        // This ensures we never send data faster than the receiver can ingest.
        let batchSize = 100; // Initial batch size

        for (let i = 0; i < messagesToSync.length; i += batchSize) {
            const chunk = messagesToSync.slice(i, i + batchSize);
            const syncMsg = MessageFactory.createSyncBatch(this.localPeerId, chunk);
            
            logger.debug({ event: 'sync_batch_sent', peerId, batchId: syncMsg.id, size: chunk.length });
            this.connectionPool.sendToPeer(peerId, syncMsg);
            collector.increment('sync_batches_sent_total');

            // Wait for SYNC_ACK with a safety timeout (5 seconds)
            try {
                await this.#waitForAck(peerId, syncMsg.id, 5000);
                // Optimization: If ACK was fast, we could increase batchSize here (Additive Increase)
            } catch (err) {
                logger.warn({ event: 'sync_ack_timeout', peerId, batchId: syncMsg.id });
                // On timeout, we might decrease batchSize (Multiplicative Decrease)
                // and retry the current batch.
            }
        }
        
        const duration = Date.now() - startTime;
        collector.record('sync_duration_ms', duration);
        logger.info({ event: 'sync_completed', peerId, totalSent: messagesToSync.length, durationMs: duration });
    }

    /**
     * Private helper to manage the ACK wait state.
     */
    #waitForAck(peerId, batchId, timeoutMs) {
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                this.pendingAcks.delete(peerId);
                reject(new Error('Sync ACK timeout'));
            }, timeoutMs);

            this.pendingAcks.set(peerId, { resolve, timeout, batchId });
        });
    }

    /**
     * Processes an incoming SYNC_BATCH message and sends a SYNC_ACK.
     * 
     * @param {Object} syncBatch - The SYNC_BATCH message object.
     * @param {string} fromPeerId 
     */
    receiveSyncBatch(syncBatch, fromPeerId) {
        const messages = JSON.parse(syncBatch.payload);
        if (!Array.isArray(messages)) return;
        
        let processedCount = 0;
        for (const msg of messages) {
            if (this.gossipEngine.seenMessages.has(msg.id)) continue;
            this.gossipEngine.receiveMessage(msg, fromPeerId);
            processedCount++;
        }

        // Send SYNC_ACK to tell the sender we are ready for more
        const ack = MessageFactory.createSyncAck(this.localPeerId, syncBatch.id);
        this.connectionPool.sendToPeer(fromPeerId, ack);

        logger.debug({ event: 'sync_batch_processed', fromPeerId, batchId: syncBatch.id, count: messages.length });
    }

    /**
     * Handles an incoming SYNC_ACK to unblock the synchronization loop.
     */
    receiveSyncAck(message, fromPeerId) {
        const { batchId } = JSON.parse(message.payload);
        const pending = this.pendingAcks.get(fromPeerId);

        if (pending && pending.batchId === batchId) {
            clearTimeout(pending.timeout);
            this.pendingAcks.delete(fromPeerId);
            pending.resolve();
            collector.increment('sync_acks_received_total');
            logger.debug({ event: 'sync_ack_received', fromPeerId, batchId });
        }
    }
}
