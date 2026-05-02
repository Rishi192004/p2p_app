import pino from 'pino';
import { MessageFactory } from '../protocol/messageFactory.js';

const logger = pino({ name: 'syncManager' });

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
    constructor(db, messageStore, gossipEngine, connectionPool) {
        this.db = db;
        this.messageStore = messageStore;
        this.gossipEngine = gossipEngine;
        this.connectionPool = connectionPool;
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
     * 
     * @param {string} peerId 
     */
    async onPeerReconnected(peerId) {
        const lastSeenLamport = await this.getLastSeenLamport(peerId);
        
        // WHAT HAPPENS IF PEER OFFLINE FOR TOO LONG?
        // If a peer is offline longer than the prune cutoff time (e.g., messages older 
        // than 7 days have been deleted), this incremental Lamport timestamp sync will 
        // miss messages. To properly support peers returning after extended absences, 
        // we would need to implement a full state Snapshot Sync (e.g., exchanging Merkle 
        // trees or Bloom filters of current state) instead of just an incremental log replay.
        
        logger.info({ event: 'sync_started', peerId, since: lastSeenLamport });

        // Retrieve all messages across all topics since the timestamp
        // For simplicity, we just sync the 'global' topic. In a real system, 
        // we'd query across subscribed topics.
        const messagesToSync = await this.messageStore.getByTopic('global', lastSeenLamport);
        
        if (messagesToSync.length === 0) {
            return; // Nothing to sync
        }

        // Rate-limit: max 100 messages per sync burst, then pause 500ms
        const CHUNK_SIZE = 100;
        const PAUSE_MS = 500;

        for (let i = 0; i < messagesToSync.length; i += CHUNK_SIZE) {
            const chunk = messagesToSync.slice(i, i + CHUNK_SIZE);
            
            const syncMsg = MessageFactory.createSyncBatch('system', chunk); // Create a SYNC_BATCH message
            
            this.connectionPool.sendToPeer(peerId, syncMsg);

            if (i + CHUNK_SIZE < messagesToSync.length) {
                // Wait before sending the next burst
                await new Promise(resolve => setTimeout(resolve, PAUSE_MS));
            }
        }
        
        logger.info({ event: 'sync_completed', peerId, totalSent: messagesToSync.length });
    }

    /**
     * Processes an incoming SYNC_BATCH message.
     * 
     * @param {Array} messages - Array of missing P2P messages.
     * @param {string} fromPeerId 
     */
    receiveSyncBatch(messages, fromPeerId) {
        if (!Array.isArray(messages)) return;
        
        let processedCount = 0;
        
        for (const msg of messages) {
            if (this.gossipEngine.seenMessages.has(msg.id)) {
                continue; // Skip already seen
            }
            
            // Feed into gossip engine as if freshly received
            this.gossipEngine.receiveMessage(msg, fromPeerId);
            processedCount++;
        }

        logger.debug({ event: 'sync_batch_received', fromPeerId, total: messages.length, processed: processedCount });
    }
}
