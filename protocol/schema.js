/**
 * Protocol Message Schema Definitions
 * 
 * System Design Reason: A strict canonical schema is essential for a P2P network 
 * because peers are inherently untrusted and varied. Using JSDoc typedefs in ES Modules
 * provides IDE support, allows static analysis (via TS or similar tools), and clearly
 * documents the expected structure without requiring a full TypeScript compilation step.
 */

/**
 * @typedef {'CHAT' | 'ACK' | 'HEARTBEAT' | 'PEER_EXCHANGE'} MessageType
 * Defines the allowed message types in the P2P protocol.
 */

/**
 * The canonical format for all messages transmitted in the P2P network.
 * @typedef {Object} P2PMessage
 * @property {string} id - UUIDv4 identifying the message uniquely across the network.
 * @property {MessageType} type - The type of message being sent.
 * @property {number} ttl - Time-to-Live, an integer (max 10) representing remaining hops.
 * @property {number} lamportTimestamp - Logical clock timestamp for partial ordering of events.
 * @property {string} sender - The peerId of the node that originated the message.
 * @property {string} topic - The pub/sub topic the message belongs to (default "global").
 * @property {string} payload - The actual content/data of the message (JSON stringified if complex).
 * @property {string} [signature] - Optional base64 Ed25519 signature for verifying message authenticity.
 * @property {string} createdAt - ISO 8601 string of when the message was created.
 */

export {}; // Make it an ES Module
