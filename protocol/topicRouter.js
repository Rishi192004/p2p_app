/**
 * Topic Router
 * 
 * Manages topic subscriptions for connected peers in the P2P network.
 * 
 * === PUB/SUB BROKER (KAFKA) VS GOSSIP TOPICS TRADEOFF ===
 * A centralized broker like Kafka provides absolute guarantees on message delivery, 
 * ordering, and durable topic subscriptions. It is the gold standard for enterprise pub/sub.
 * However, Kafka requires massive central infrastructure. 
 * 
 * By using a Topic Router combined with Epidemic Gossip, we achieve a serverless, 
 * decentralized pub/sub mechanism. The tradeoff is that we lose strict delivery 
 * guarantees (messages might not reach a peer if the subgraph is poorly connected) 
 * and subscriptions are ephemeral, but we gain a highly resilient system with 
 * zero central points of failure and zero infrastructural cost.
 */
export class TopicRouter {
    constructor() {
        /**
         * Maps a topic name to a Set of subscribed peer IDs.
         * @type {Map<string, Set<string>>}
         */
        this.subscriptions = new Map();
    }

    /**
     * Subscribes a peer to a specific topic.
     * @param {string} peerId 
     * @param {string} topic 
     */
    subscribe(peerId, topic) {
        if (!this.subscriptions.has(topic)) {
            this.subscriptions.set(topic, new Set());
        }
        this.subscriptions.get(topic).add(peerId);
    }

    /**
     * Unsubscribes a peer from a specific topic.
     * @param {string} peerId 
     * @param {string} topic 
     */
    unsubscribe(peerId, topic) {
        if (this.subscriptions.has(topic)) {
            const subscribers = this.subscriptions.get(topic);
            subscribers.delete(peerId);
            
            // Clean up empty topics to prevent memory leaks over time
            if (subscribers.size === 0) {
                this.subscriptions.delete(topic);
            }
        }
    }

    /**
     * Retrieves all peer IDs subscribed to a specific topic.
     * @param {string} topic 
     * @returns {Set<string>} A Set of peer IDs, or an empty Set if the topic doesn't exist.
     */
    getPeersForTopic(topic) {
        return this.subscriptions.get(topic) || new Set();
    }
}
