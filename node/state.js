import { LamportClock } from '../protocol/lamportClock.js';

/**
 * Centralized State Store for the P2P Node
 * 
 * System Design Reason: All state mutations MUST go through this module. 
 * This prevents fragmented state updates across different files and makes 
 * debugging, serialization, and concurrency management much simpler.
 */
class State {
    constructor() {
        // Map<peerId, PeerInfo> where PeerInfo = { host, port, lastSeen, status, lamportTime }
        this._peers = new Map();
        
        // Set<messageId>
        this._seenMessages = new Set();
        
        this.lamportClock = new LamportClock();
        
        // Map<topicName, Set<peerId>> — for Phase 2 pub/sub
        this._topics = new Map();

        // Thresholds
        this.MAX_SEEN_MESSAGES = 10000;
        this.CLEANUP_COUNT = 1000;
    }

    // --- Peer Management ---
    setPeer(peerId, peerInfo) {
        this._peers.set(peerId, peerInfo);
    }

    getPeer(peerId) {
        return this._peers.get(peerId);
    }

    hasPeer(peerId) {
        return this._peers.has(peerId);
    }

    deletePeer(peerId) {
        this._peers.delete(peerId);
    }

    getPeerEntries() {
        return Array.from(this._peers.entries());
    }

    /**
     * @returns {number} The total number of registered peers
     */
    getPeerCount() {
        return this._peers.size;
    }

    /**
     * @returns {number} The number of peers in ACTIVE state
     */
    getActivePeerCount() {
        let count = 0;
        for (const peer of this._peers.values()) {
            if (peer.status === 'ACTIVE') count++;
        }
        return count;
    }

    // --- Seen Messages Management ---
    /**
     * Adds a message ID to the seen cache and performs memory bounds checking.
     * @param {string} messageId 
     */
    addSeenMessage(messageId) {
        this._seenMessages.add(messageId);

        // Auto-cleanup: if Set size > 10,000 entries, remove oldest 1,000
        // Comment: Why we need this (memory bound) and what we risk (rare redelivery of old messages)
        // Without this, the Set would grow infinitely and crash the Node process (OOM). 
        // By removing the oldest messages, we risk that a very delayed message (older than the
        // cleanup window) could be re-processed and re-gossiped. However, since TTL also
        // naturally kills old messages, this risk is extremely low in a healthy network.
        if (this._seenMessages.size > this.MAX_SEEN_MESSAGES) {
            const iterator = this._seenMessages.values();
            for (let i = 0; i < this.CLEANUP_COUNT; i++) {
                this._seenMessages.delete(iterator.next().value);
            }
        }
    }

    hasSeenMessage(messageId) {
        return this._seenMessages.has(messageId);
    }

    // --- Topics Management ---
    addPeerToTopic(topicName, peerId) {
        if (!this._topics.has(topicName)) {
            this._topics.set(topicName, new Set());
        }
        this._topics.get(topicName).add(peerId);
    }
}

const state = new State();
export default state;
