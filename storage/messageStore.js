import { createLogger } from '../utils/logger.js';
import collector from '../metrics/collector.js';

const logger = createLogger('messageStore');

/**
 * MessageStore handles persistent storage of P2P messages using LevelDB.
 * 
 * === LEVELDB VS REDIS TRADEOFF ===
 * We use LevelDB (an embedded database) instead of Redis (a networked database)
 * because a true decentralized P2P node should be self-contained. Running a 
 * separate Redis server per node increases operational complexity, whereas 
 * LevelDB runs in the same process, has zero network latency, and requires 
 * no external daemon. This perfectly suits a lightweight gossip client.
 */
export class MessageStore {
    constructor(db) {
        this.db = db;
        
        // Batch write buffer
        this.writeBuffer = [];
        this.batchTimer = null;
        this.MAX_BUFFER_SIZE = 50;
        this.FLUSH_INTERVAL_MS = 100;
    }

    /**
     * Helper to generate the canonical key for a message.
     * 
     * Key Schema: msg:{topic}:{lamportTimestamp}:{messageId}
     * 
     * System Design Reason: LevelDB sorts keys lexicographically. By putting 
     * the topic first, all messages for a specific topic are grouped together.
     * By putting the Lamport timestamp second, messages within a topic are 
     * chronologically sorted (according to the logical clock). This allows 
     * extremely efficient range scans (e.g., "get all messages in topic 'global' 
     * since timestamp 42") without needing secondary indexes. The messageId 
     * ensures uniqueness if two messages happen to share the same timestamp.
     */
    _makeKey(topic, lamportTimestamp, messageId) {
        // Pad timestamp so lexicographical sort matches numeric sort (e.g., up to 15 digits)
        const paddedTs = String(lamportTimestamp).padStart(15, '0');
        return `msg:${topic}:${paddedTs}:${messageId}`;
    }



    /**
     * Flushes buffered writes to LevelDB.
     */
    async flush() {
        if (this.writeBuffer.length === 0) return;

        if (this.batchTimer) {
            clearTimeout(this.batchTimer);
            this.batchTimer = null;
        }

        const batch = this.writeBuffer.splice(0, this.writeBuffer.length);
        const start = Date.now();
        try {
            await this.db.batch(batch);
            const duration = Date.now() - start;
            collector.record('storage_write_ms', duration);
            logger.debug({ event: 'batch_flushed', count: batch.length, duration_ms: duration });
        } catch (error) {
            logger.error({ event: 'batch_flush_error', error: error.message });
        }
    }

    /**
     * Range scan returning messages after a Lamport time for a specific topic.
     * @param {string} topic 
     * @param {number} sinceTimestamp 
     * @returns {Promise<Array>}
     */
    async getByTopic(topic, sinceTimestamp) {
        // We want to return after the sync burst is finished flushing if any
        await this.flush();

        const paddedTs = String(sinceTimestamp).padStart(15, '0');
        const startKey = `msg:${topic}:${paddedTs}:`;
        // '~' is a high ascii character, ensures we get everything after startKey in the topic
        const endKey = `msg:${topic}:~`; 

        const messages = [];
        try {
            for await (const [, value] of this.db.iterator({ gte: startKey, lte: endKey })) {
                const msg = JSON.parse(value);
                // strictly greater than sinceTimestamp, or greater than or equal?
                // Usually "since" means strictly greater than.
                if (msg.lamportTimestamp > sinceTimestamp) {
                    messages.push(msg);
                }
            }
        } catch (error) {
            logger.error({ event: 'get_by_topic_error', error: error.message });
        }
        return messages;
    }

    /**
     * Point lookup for a message by ID. 
     * Note: Since ID is at the end of the key, we have to scan or maintain a secondary index.
     * Because the prompt specifies the schema doesn't have a secondary index, we do a full scan,
     * OR we can store a small secondary index. Let's just store a secondary index `id:{messageId}` -> `msgKey`.
     */
    async getById(messageId) {
        // Since key schema is msg:topic:ts:id, we can't do direct get() without knowing topic and ts.
        // Wait, I will add an index on save: id:${messageId} -> fullKey
        // Let me modify the save behavior to also save the ID reference.
        try {
            await this.flush(); // ensure it's written
            const refKey = `id:${messageId}`;
            const fullKey = await this.db.get(refKey);
            const value = await this.db.get(fullKey);
            return JSON.parse(value);
        } catch (err) {
            if (err.code === 'LEVEL_NOT_FOUND') return null;
            throw err;
        }
    }

    /**
     * Stores a full message JSON.
     * 
     * === BATCH WRITE STRATEGY ===
     * In a gossip network, messages often arrive in rapid bursts. Buffering 
     * writes and flushing them in batches significantly reduces disk I/O and 
     * context switching overhead compared to writing each message individually.
     * It increases throughput at the cost of a tiny (max 100ms) durability window.
     * 
     * Overrides save to include secondary index for getById.
     */
    async save(message) {
        const key = this._makeKey(message.topic, message.lamportTimestamp, message.id);
        const value = JSON.stringify(message);

        this.writeBuffer.push({ type: 'put', key, value });
        this.writeBuffer.push({ type: 'put', key: `id:${message.id}`, value: key });

        if (this.writeBuffer.length >= this.MAX_BUFFER_SIZE) {
            await this.flush();
        } else if (!this.batchTimer) {
            this.batchTimer = setTimeout(() => this.flush(), this.FLUSH_INTERVAL_MS);
        }
    }

    /**
     * Stores delivery receipt.
     */
    async markDelivered(messageId, peerId) {
        const receiptKey = `receipt:${messageId}:${peerId}`;
        try {
            await this.db.put(receiptKey, Date.now().toString());
        } catch (err) {
            logger.error({ event: 'mark_delivered_error', error: err.message });
        }
    }

    /**
     * Deletes messages older than olderThanMs (call on startup).
     * @param {number} olderThanMs 
     */
    async prune(olderThanMs) {
        await this.flush();
        const cutoffTime = Date.now() - olderThanMs;
        const batch = [];
        
        try {
            // We iterate all messages and check their createdAt
            // LevelDB iterator allows us to scan all `msg:` keys
            for await (const [key, value] of this.db.iterator({ gte: 'msg:', lte: 'msg:~' })) {
                const msg = JSON.parse(value);
                const createdAtMs = new Date(msg.createdAt).getTime();
                if (createdAtMs < cutoffTime) {
                    batch.push({ type: 'del', key });
                    batch.push({ type: 'del', key: `id:${msg.id}` });
                }
            }

            if (batch.length > 0) {
                await this.db.batch(batch);
                logger.info({ event: 'prune_completed', prunedCount: batch.length / 2 });
            }
        } catch (error) {
            logger.error({ event: 'prune_error', error: error.message });
        }
    }
}
