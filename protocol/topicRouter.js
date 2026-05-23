class Route {
    constructor(nextHop, hopCount, sequenceNumber, path, expiresAt) {
        this.nextHop = nextHop;               // The immediate neighbor to forward to
        this.hopCount = hopCount;             // Distance metric (number of hops)
        this.sequenceNumber = sequenceNumber; // Sequence number to prevent stale updates
        this.path = path;                     // Node path traversed to prevent loops
        this.expiresAt = expiresAt;           // Expiry timestamp (soft-state)
    }
}

/**
 * Topic Router
 * 
 * Manages multi-hop subscription routing tables for connected peers.
 */
export class TopicRouter {
    constructor() {
        /**
         * Maps a topic name to a Map of origin peer IDs to their corresponding Route.
         * @type {Map<string, Map<string, Route>>}
         */
        this.routes = new Map();
    }

    /**
     * Legacy helper to subscribe a peer directly (0-hop route, nextHop is peerId).
     * @param {string} peerId 
     * @param {string} topic 
     */
    subscribe(peerId, topic) {
        // Direct local or connection subscription (expiresAt is Infinity)
        this.updateRoute(topic, peerId, peerId, 0, 0, [], Infinity);
    }

    /**
     * Legacy helper to unsubscribe a peer directly.
     * @param {string} peerId 
     * @param {string} topic 
     */
    unsubscribe(peerId, topic) {
        this.removeRoute(topic, peerId);
    }

    /**
     * Updates or inserts a route in the distance-vector table.
     * 
     * @returns {boolean} True if the route is new or has been updated (meaning we should propagate it).
     */
    updateRoute(topic, originPeerId, nextHop, hopCount, sequenceNumber, path, expiresAt) {
        if (!this.routes.has(topic)) {
            this.routes.set(topic, new Map());
        }
        const topicRoutes = this.routes.get(topic);
        const existing = topicRoutes.get(originPeerId);

        if (existing) {
            // Ignore older sequence numbers
            if (sequenceNumber < existing.sequenceNumber) {
                return false;
            }
            // Ignore longer/equal paths if sequence number is the same
            if (sequenceNumber === existing.sequenceNumber && hopCount >= existing.hopCount) {
                // If it is the same nextHop, refresh the lease
                if (nextHop === existing.nextHop) {
                    existing.expiresAt = Math.max(existing.expiresAt, expiresAt);
                }
                return false;
            }
        }

        topicRoutes.set(originPeerId, new Route(nextHop, hopCount, sequenceNumber, path, expiresAt));
        return true;
    }

    /**
     * Removes a route from the routing table.
     */
    removeRoute(topic, originPeerId) {
        const topicRoutes = this.routes.get(topic);
        if (topicRoutes) {
            const deleted = topicRoutes.delete(originPeerId);
            if (topicRoutes.size === 0) {
                this.routes.delete(topic);
            }
            return deleted;
        }
        return false;
    }

    /**
     * Retrieves all next-hop peer IDs leading to subscribers of a specific topic.
     * 
     * @param {string} topic 
     * @param {number} [now=Date.now()]
     * @returns {Set<string>} A Set of peer IDs of neighbors to forward to.
     */
    getPeersForTopic(topic, now = Date.now()) {
        const peers = new Set();
        const topicRoutes = this.routes.get(topic);
        if (topicRoutes) {
            for (const route of topicRoutes.values()) {
                if (now <= route.expiresAt) {
                    peers.add(route.nextHop);
                }
            }
        }
        return peers;
    }

    /**
     * Retrieves all topics that a specific peer has subscribed to (where they are the origin).
     * 
     * @param {string} peerId 
     * @returns {string[]} An array of topic names.
     */
    getTopicsForPeer(peerId) {
        const topics = new Set();
        // Every peer is implicitly subscribed to 'global' and their DM channel
        topics.add('global');
        topics.add(`dm:${peerId}`);

        for (const [topic, topicRoutes] of this.routes.entries()) {
            if (topicRoutes.has(peerId)) {
                topics.add(topic);
            }
        }
        return Array.from(topics);
    }

    /**
     * Clears all routing entries associated with a disconnected peer.
     * 
     * @param {string} peerId 
     */
    clearRoutesForPeer(peerId) {
        for (const [topic, topicRoutes] of this.routes.entries()) {
            for (const [originPeerId, route] of topicRoutes.entries()) {
                if (route.nextHop === peerId || originPeerId === peerId) {
                    topicRoutes.delete(originPeerId);
                }
            }
            if (topicRoutes.size === 0) {
                this.routes.delete(topic);
            }
        }
    }

    /**
     * Garbage collects expired soft-state routes.
     * 
     * @param {number} now 
     */
    gc(now) {
        for (const [topic, topicRoutes] of this.routes.entries()) {
            for (const [originPeerId, route] of topicRoutes.entries()) {
                if (now > route.expiresAt) {
                    topicRoutes.delete(originPeerId);
                }
            }
            if (topicRoutes.size === 0) {
                this.routes.delete(topic);
            }
        }
    }
}
