/**
 * Configuration constants for the P2P network.
 * 
 * System Design Reason: Centralizing configuration prevents magic numbers,
 * makes the system easily tunable for different environments (dev/prod),
 * and allows for easy updates to network parameters like timeouts and fanout.
 */
export default {
    /**
     * Number of peers to gossip a message to.
     * Tuned for balance between network coverage and bandwidth efficiency.
     */
    GOSSIP_FANOUT: 3,

    /**
     * Maximum hops a message can take before being discarded.
     * Prevents infinite propagation in disconnected subgraphs or edge cases.
     */
    MAX_TTL: 10,

    /**
     * Interval for sending heartbeat messages to active peers.
     * Ensures connections are alive and helps detect silent failures.
     */
    HEARTBEAT_INTERVAL_MS: 5000,

    /**
     * Time to wait before considering a peer dead/unresponsive.
     * Should be larger than HEARTBEAT_INTERVAL_MS.
     */
    PEER_TIMEOUT_MS: 15000,

    /**
     * Time to wait for an acknowledgment (ACK) of a critical message.
     */
    ACK_TIMEOUT_MS: 3000,

    /**
     * Maximum number of retry attempts for failed critical message deliveries.
     */
    MAX_RETRY_ATTEMPTS: 3,

    /**
     * File path for the local LevelDB instance.
     */
    STORAGE_PATH: './data',

    /**
     * Default port for the WebSocket server.
     */
    PORT: process.env.PORT ? parseInt(process.env.PORT) : 8080,
    
    /**
     * Peer Identity
     */
    PEER_ID: process.env.PEER_ID || null,

    /**
     * Maximum number of active outbound peer connections allowed.
     */
    MAX_PEERS: 50,

    /**
     * Starting delay for exponential backoff during reconnection.
     */
    INITIAL_RECONNECT_DELAY_MS: 1000,

    /**
     * Maximum delay cap for exponential backoff (30 seconds).
     */
    MAX_RECONNECT_DELAY_MS: 30000,
    
    /**
     * Rate Limiting
     */
    RATE_LIMIT_CAPACITY: process.env.RATE_LIMIT_CAPACITY ? parseInt(process.env.RATE_LIMIT_CAPACITY) : 20,
    RATE_LIMIT_REFILL_RATE: process.env.RATE_LIMIT_REFILL_RATE ? parseInt(process.env.RATE_LIMIT_REFILL_RATE) : 5,

    /**
     * Maximum number of consecutive retry attempts before marking connection failed.
     */
    MAX_RECONNECT_ATTEMPTS: 5,

    /**
     * Sybil Defense: Proof-of-Work difficulty.
     * Higher value = more CPU work required per message.
     */
    POW_DIFFICULTY: 500
};
