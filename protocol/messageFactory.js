import { v4 as uuidv4 } from 'uuid';
import config from '../config/default.js';
import { pow } from '../utils/pow.js';

/**
 * Message Factory
 * 
 * System Design Reason: Centralizing message creation ensures that all messages
 * injected into the network conform to the strict P2PMessage schema. It abstracts
 * away boilerplate (like UUID generation and timestamping) and reduces human error
 * when defining fields like TTL and topics.
 */
export class MessageFactory {
    /**
     * Internal logical clock for Lamport Timestamps.
     * @type {number}
     */
    static #logicalClock = 0;

    /**
     * Base builder to construct a standard P2P message.
     * @param {import('./schema.js').MessageType} type 
     * @param {string} sender 
     * @param {string} payload 
     * @param {Object} [options] 
     * @param {string} [options.topic="global"]
     * @param {number} [options.ttl=config.MAX_TTL]
     * @returns {import('./schema.js').P2PMessage}
     */
    static #createBaseMessage(type, sender, payload, options = {}) {
        this.#logicalClock++;
        
        const id = uuidv4();
        
        // Solve Proof-of-Work puzzle for the message ID
        // This makes "Identity" expensive and prevents Sybil/Spam attacks.
        const workNonce = pow.solvePuzzle(id, config.POW_DIFFICULTY);

        return {
            id,
            type,
            ttl: options.ttl ?? config.MAX_TTL,
            lamportTimestamp: this.#logicalClock,
            sender,
            senderPublicKey: options.senderPublicKey || null,
            topic: options.topic ?? 'global',
            payload,
            createdAt: new Date().toISOString(),
            powNonce: workNonce // Attach the solution
        };
    }

    /**
     * Creates a CHAT message.
     * 
     * System Design Reason: Separates user-facing data payloads from control 
     * messages like ACKs, allowing different routing or priority logic.
     * 
     * @param {string} sender - Originating peer ID.
     * @param {string} text - Chat message content.
     * @param {string} [topic="global"] - Channel or topic.
     * @param {string} [senderPublicKey] - Optional public key for verification.
     * @returns {import('./schema.js').P2PMessage}
     */
    static createChat(sender, text, topic = 'global', senderPublicKey = null) {
        return this.#createBaseMessage('CHAT', sender, text, { topic, senderPublicKey });
    }

    /**
     * Creates an ACK (Acknowledgment) message.
     * 
     * System Design Reason: Essential for reliable delivery over unreliable UDP/WebSocket
     * connections. Target peers respond with an ACK to confirm receipt.
     * 
     * @param {string} sender - Peer sending the ACK.
     * @param {string} messageIdToAck - The ID of the message being acknowledged.
     * @returns {import('./schema.js').P2PMessage}
     */
    static createAck(sender, messageIdToAck) {
        // ACKs shouldn't bounce around the network endlessly, low TTL.
        return this.#createBaseMessage('ACK', sender, JSON.stringify({ ackId: messageIdToAck }), { ttl: 2 });
    }

    /**
     * Creates a HEARTBEAT message.
     * 
     * System Design Reason: Used to maintain connection liveness state and 
     * proactively detect dead peers without waiting for a TCP timeout.
     * 
     * @param {string} sender - Peer sending the heartbeat.
     * @returns {import('./schema.js').P2PMessage}
     */
    static createHeartbeat(sender) {
        return this.#createBaseMessage('HEARTBEAT', sender, 'ping', { ttl: 1 });
    }

    /**
     * Creates a PEER_EXCHANGE message.
     * 
     * System Design Reason: Allows the network to heal and expand dynamically 
     * by gossiping known peer addresses to neighbors.
     * 
     * @param {string} sender - Peer sharing their known list.
     * @param {string[]} knownPeers - Array of peer addresses/IDs.
     * @returns {import('./schema.js').P2PMessage}
     */
    static createPeerExchange(sender, knownPeers) {
        return this.#createBaseMessage('PEER_EXCHANGE', sender, JSON.stringify(knownPeers), { ttl: 3 });
    }

    /**
     * Creates a SYNC_BATCH message.
     * 
     * System Design Reason: Groups multiple missing messages into a single transport 
     * frame for efficient offline state synchronization when a peer reconnects.
     * 
     * @param {string} sender - Node sending the sync batch.
     * @param {Array} messages - Array of missing messages.
     * @returns {import('./schema.js').P2PMessage}
     */
    static createSyncBatch(sender, messages) {
        return this.#createBaseMessage('SYNC_BATCH', sender, JSON.stringify(messages), { ttl: 1 });
    }

    /**
     * Creates a SYNC_ACK message.
     * 
     * System Design Reason: Used for backpressure/flow control. The receiver 
     * sends this after processing a batch to tell the sender it's ready for the next one.
     * 
     * @param {string} sender - Node sending the ack.
     * @param {string} batchId - The ID of the SYNC_BATCH being acknowledged.
     * @returns {import('./schema.js').P2PMessage}
     */
    static createSyncAck(sender, batchId) {
        return this.#createBaseMessage('SYNC_ACK', sender, JSON.stringify({ batchId }), { ttl: 1 });
    }

    /**
     * Creates a SUB_AD (Subscription Advertisement) message.
     * 
     * @param {string} sender - Originating peer ID.
     * @param {string} topic - Topic name.
     * @param {number} sequenceNumber - Monotonically increasing sequence number.
     * @param {'JOIN'|'LEAVE'} action - Join or leave action.
     * @param {string[]} path - Explored path to prevent loops.
     * @param {string} [senderPublicKey=null] - Originating peer's public key.
     * @returns {import('./schema.js').P2PMessage}
     */
    static createSubAd(sender, topic, sequenceNumber, action = 'JOIN', path = [], senderPublicKey = null) {
        const msg = this.#createBaseMessage('SUB_AD', sender, JSON.stringify({
            topic,
            sequenceNumber,
            action
        }), { ttl: config.MAX_TTL, senderPublicKey });
        msg.routingPath = path;
        return msg;
    }

    /**
     * Creates a SUMMARY message.
     * 
     * @param {string} sender - Originating peer ID.
     * @param {string} topic - The topic the summary belongs to.
     * @param {string} summaryText - The text of the summary.
     * @param {Object} [metadata={}] - Additional details (e.g. mode, message count).
     * @param {string} [senderPublicKey] - Optional public key for verification.
     * @returns {import('./schema.js').P2PMessage}
     */
    static createSummary(sender, topic, summaryText, metadata = {}, senderPublicKey = null) {
        const payload = JSON.stringify({
            summary: summaryText,
            metadata
        });
        return this.#createBaseMessage('SUMMARY', sender, payload, { topic, senderPublicKey });
    }
}
