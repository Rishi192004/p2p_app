import { EventEmitter } from 'events';
import config from '../config/default.js';
import pino from 'pino';

const logger = pino({ name: 'gossipEngine' });

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
    constructor(connectionPool, lamportClock) {
        super();
        this.connectionPool = connectionPool;
        this.lamportClock = lamportClock;
        
        // Data Structure Choice: Set over Array. Checking if an element exists in a Set
        // is O(1), whereas an Array is O(N). Since we perform a lookup for every single 
        // incoming message, Set is drastically more efficient.
        this.seenMessages = new Set();
        
        // Metrics
        this.metrics = { duplicate_received: 0, new_received: 0, forwarded: 0 };
    }

    /**
     * Processes an incoming message from a peer.
     * 
     * @param {Object} message 
     * @param {string} fromPeerId 
     */
    receiveMessage(message, fromPeerId) {
        // Update local lamport clock
        if (message.lamportTimestamp) {
            this.lamportClock.update(message.lamportTimestamp);
        }

        if (this.seenMessages.has(message.id)) {
            // If seen: drop silently, log metric
            this.metrics.duplicate_received++;
            logger.debug({ event: 'message_dropped', reason: 'duplicate', id: message.id });
            return;
        }

        // If new: add to seen set
        this.seenMessages.add(message.id);
        this.metrics.new_received++;

        // Decrement TTL, if TTL > 0 -> forward
        message.ttl -= 1;

        if (message.ttl > 0) {
            this.forwardMessage(message, fromPeerId);
        } else {
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
        const activePeers = Array.from(this.connectionPool.outboundConnections.keys());
        
        // We want to exclude the originator and the immediate sender
        const excludeBase = new Set();
        excludeBase.add(message.sender);
        if (fromPeerId) {
            excludeBase.add(fromPeerId);
        }

        const availablePeers = activePeers.filter(p => !excludeBase.has(p));
        
        // Select K random peers
        const k = Math.min(config.GOSSIP_FANOUT, availablePeers.length);
        const selectedPeers = new Set();
        
        while (selectedPeers.size < k && availablePeers.length > 0) {
            const randomIndex = Math.floor(Math.random() * availablePeers.length);
            selectedPeers.add(availablePeers[randomIndex]);
            availablePeers.splice(randomIndex, 1);
        }

        // connectionPool.broadcast takes an array of peers to EXCLUDE
        // So we need to exclude everyone who is NOT in selectedPeers
        const finalExcludeList = activePeers.filter(p => !selectedPeers.has(p));

        // Always exclude the message sender and immediate sender
        for (const peer of excludeBase) {
            if (!finalExcludeList.includes(peer)) {
                finalExcludeList.push(peer);
            }
        }

        this.connectionPool.broadcast(message, finalExcludeList);
        this.metrics.forwarded++;
    }
}
