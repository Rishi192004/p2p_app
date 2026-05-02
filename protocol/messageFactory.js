import { v4 as uuidv4 } from 'uuid';
import config from '../config/default.js';

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
        
        return {
            id: uuidv4(),
            type,
            ttl: options.ttl ?? config.MAX_TTL,
            lamportTimestamp: this.#logicalClock,
            sender,
            topic: options.topic ?? 'global',
            payload,
            createdAt: new Date().toISOString()
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
     * @returns {import('./schema.js').P2PMessage}
     */
    static createChat(sender, text, topic = 'global') {
        return this.#createBaseMessage('CHAT', sender, text, { topic });
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
}
