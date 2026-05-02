/**
 * In-memory FIFO queue for messages waiting to be sent to offline/connecting peers.
 * 
 * Data Structure Choice: We use a JavaScript Array for the queue. While Map or Object 
 * gives O(1) lookup, an Array is the natural structure for a FIFO queue. Since we are 
 * mostly pushing to the end and shifting from the front, Array provides the right semantics. 
 * We maintain queues per peer using a Map<peerId, Array>.
 */
export class PendingQueue {
    constructor(maxQueueSize = 1000) {
        // Map over Object: Maps allow any string type as keys, are iterable, and don't have
        // inherited prototype properties. Ideal for mapping peerIds to their queues.
        this.queues = new Map();
        this.maxQueueSize = maxQueueSize;
    }

    /**
     * Enqueues a message for a specific peer.
     * Tradeoff: Dropping the oldest message when full ensures that we don't leak memory
     * when a peer is permanently offline or slow. However, this means we sacrifice 
     * reliable delivery of old messages for system stability.
     * 
     * @param {string} peerId 
     * @param {Object} message 
     */
    enqueue(peerId, message) {
        if (!this.queues.has(peerId)) {
            this.queues.set(peerId, []);
        }

        const queue = this.queues.get(peerId);
        queue.push(message);

        // Cap size: drop oldest if full
        if (queue.length > this.maxQueueSize) {
            queue.shift(); // Drop the oldest message
        }
    }

    /**
     * Drains the queued messages for a specific peer when they connect.
     * @param {string} peerId 
     * @returns {Array<Object>}
     */
    flush(peerId) {
        if (this.queues.has(peerId)) {
            const messages = this.queues.get(peerId);
            this.queues.delete(peerId);
            return messages;
        }
        return [];
    }
}
