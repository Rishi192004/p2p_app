import { EventEmitter } from 'events';
import config from '../config/default.js';
import { createLogger } from '../utils/logger.js';
import { RateLimiter } from './rateLimiter.js';
import { TopicRouter } from './topicRouter.js';
import collector from '../metrics/collector.js';

import { pow } from '../utils/pow.js';

const logger = createLogger('gossipEngine');

/**
 * Core Gossip Protocol Engine
 * 
 * === SCALABILITY NOTES ===
 * Fanout Math: If each node selects K (GOSSIP_FANOUT) peers to forward a message to,
 * the number of messages grows exponentially at each hop: O(K^H) where H is the hop count.
 * In a network of N nodes, a full broadcast without duplicate checking could generate 
 * O(N * K) messages (or worse, infinite loops). By using the seenMessages cache, 
 * the total number of messages across the network for a single origination is 
 * roughly bounded to O(E), where E is the number of edges, but typically stops much earlier 
 * because duplicate checks halt the exponential spread.
 * 
 * === FAILURE SCENARIOS ===
 * 1. What happens if a peer crashes mid-gossip:
 *    The network relies on redundancy (fanout > 1). If a node dies before forwarding, 
 *    the other K-1 nodes that received the message will still propagate it, 
 *    ensuring high probability of eventual consistency.
 * 
 * 2. What happens with a network partition:
 *    Nodes will gossip within their isolated subnets. When the partition heals, 
 *    state reconciliation (like anti-entropy or vector clocks) is needed because
 *    standard gossip only forwards real-time messages. Buffered messages in PendingQueue 
 *    might help bridge the gap if the partition is short-lived.
 * 
 * 3. Why TTL alone isn't enough (you also need the seen-message cache):
 *    TTL prevents infinite loops in disconnected cycles, but if the TTL is 10 and K=3, 
 *    a single message could still bounce back and forth creating 3^10 (59,049) duplicate 
 *    transmissions in a small network. The seen-message cache instantly drops duplicates 
 *    (O(1)), turning exponential broadcast storms into efficient linear propagation.
 */
export class GossipEngine extends EventEmitter {
    constructor(connectionPool, lamportClock, securityManager, nodeConfig = {}) {
        super();
        this.connectionPool = connectionPool;
        this.lamportClock = lamportClock;
        this.securityManager = securityManager;
        this.nodeConfig = nodeConfig;
        // is O(1), whereas an Array is O(N). Since we perform a lookup for every single 
        // incoming message, Set is drastically more efficient.
        this.seenMessages = new Set();
        
        this.rateLimiter = new RateLimiter({
            capacity: this.nodeConfig.rateLimitCapacity,
            refillRate: this.nodeConfig.rateLimitRefillRate
        });
        this.topicRouter = new TopicRouter();
    }

    /**
     * Processes an incoming message from a peer.
     * 
     * @param {Object} message 
     * @param {string} fromPeerId 
     */
    receiveMessage(message, fromPeerId) {
        collector.increment('messages_received_total');

        // 1. Proof-of-Work Verification (Sybil Defense)
        // Every message must solve a puzzle to prove computational effort.
        if (!pow.verifyPuzzle(message.id, config.POW_DIFFICULTY, message.powNonce || 0)) {
            collector.increment('messages_dropped_pow');
            logger.warn({ event: 'message_dropped', reason: 'invalid_pow', id: message.id, from: fromPeerId });
            return;
        }

        // 2. Rate Limit Check
        // If fromPeerId is null (e.g. self-originated message), we bypass rate limiting.
        if (fromPeerId && !this.rateLimiter.checkLimit(fromPeerId)) {
            collector.increment('messages_dropped_ratelimit');
            return;
        }

        // 2. Signature Verification
        // If securityManager is provided, we verify the message signature.
        if (this.securityManager && !this.securityManager.verifyIncomingMessage(message)) {
            collector.increment('invalid_signature_count');
            return;
        }

        // Update local lamport clock
        if (message.lamportTimestamp) {
            this.lamportClock.update(message.lamportTimestamp);
        }

        // 2. Deduplication Check
        if (this.seenMessages.has(message.id)) {
            // If seen: drop silently, log metric
            collector.increment('messages_dropped_duplicate');
            logger.debug({ event: 'message_dropped', reason: 'duplicate', id: message.id });
            return;
        }

        // If new: add to seen set
        this.seenMessages.add(message.id);

        // Decrement TTL, if TTL > 0 -> forward
        message.ttl -= 1;

        if (message.ttl > 0) {
            this.forwardMessage(message, fromPeerId);
        } else {
            collector.increment('messages_dropped_ttl');
            logger.debug({ event: 'message_dropped', reason: 'ttl_expired', id: message.id });
        }

        // Emit event for the node layer to handle
        this.emit('message:new', message);
    }

    /**
     * Forwards a message to K random active peers, excluding the sender.
     * 
     * @param {Object} message 
     * @param {string} [fromPeerId] - The immediate neighbor that sent us the message
     */
    forwardMessage(message, fromPeerId = null) {
        // Active peers
        let availablePeers = this.connectionPool.getAllPeerIds();
        
        // --- TOPIC SCOPING ---
        // If the message is scoped to a specific topic, we only gossip it to peers 
        // who have explicitly subscribed to that topic.
        // Comment: this is the core benefit of topic scoping in gossip systems. 
        // Instead of blasting every message to the entire network (which wastes 
        // bandwidth), we create "sub-graphs" of interested nodes. This drastically 
        // reduces overall network chatter and allows the system to scale gracefully.
        if (message.topic && message.topic !== 'global') {
            const subscribedPeers = this.topicRouter.getPeersForTopic(message.topic);
            availablePeers = availablePeers.filter(p => subscribedPeers.has(p));
        }

        // We want to exclude the originator and the immediate sender
        const excludeBase = new Set();
        excludeBase.add(message.sender);
        if (fromPeerId) {
            excludeBase.add(fromPeerId);
        }

        availablePeers = availablePeers.filter(p => !excludeBase.has(p));
        
        // Select K random peers
        const k = Math.min(config.GOSSIP_FANOUT, availablePeers.length);
        const selectedPeers = new Set();
        
        while (selectedPeers.size < k && availablePeers.length > 0) {
            const randomIndex = Math.floor(Math.random() * availablePeers.length);
            selectedPeers.add(availablePeers[randomIndex]);
            availablePeers.splice(randomIndex, 1);
        }

        if (selectedPeers.size === 0) {
            return; // No one to forward to
        }

        // connectionPool.broadcast takes an array of peers to EXCLUDE
        // We calculate who to exclude among ALL active peers so that broadcast
        // only hits the `selectedPeers`.
        const allActivePeers = this.connectionPool.getAllPeerIds();
        const finalExcludeList = allActivePeers.filter(p => !selectedPeers.has(p));

        this.connectionPool.broadcast(message, finalExcludeList);
        collector.increment('messages_forwarded_total');
    }

    // --- Topic Router Proxies ---

    subscribe(peerId, topic) {
        this.topicRouter.subscribe(peerId, topic);
    }

    unsubscribe(peerId, topic) {
        this.topicRouter.unsubscribe(peerId, topic);
    }
}
