import { createLogger } from '../../utils/logger.js';
import state from '../state.js';

const logger = createLogger('peerExchange');

/**
 * Peer Exchange (PEX)
 * 
 * Unstructured gossip-based mechanism for sharing known peer lists.
 * 
 * === KADEMLIA COMPARISON ===
 * 1. Kademlia: A structured Distributed Hash Table (DHT). Nodes are stored in 
 *    buckets based on their XOR distance from the node's own ID. This allows for 
 *    efficient O(log N) lookups for specific keys or nodes.
 * 2. Our Approach: Unstructured Gossip + PEX. Simpler to implement but requires 
 *    more network chatter. Discovery is eventually consistent across the network 
 *    but can take O(N) worst-case time to propagate globally.
 * 
 * When to choose Kademlia: Large-scale networks (>10k nodes) needing precise 
 * resource lookup (BitTorrent/IPFS).
 * When to choose Gossip/PEX: Smaller networks or pure messaging applications 
 * where broad connectivity is more important than specific key lookup.
 */
export class PeerExchange {
    constructor(peerManager, connectionPool, localPeerId) {
        this.peerManager = peerManager;
        this.connectionPool = connectionPool;
        this.localPeerId = localPeerId;
        this.interval = null;
    }

    start() {
        // Handle incoming peer list requests/responses
        this.connectionPool.on('message:received', (message, peerId) => {
            if (message.type === 'PEER_EXCHANGE') {
                this.#handleRequest(peerId);
            } else if (message.type === 'PEER_LIST') {
                this.#handleResponse(message.peers);
            }
        });

        // Periodically gossip our known peer list to maintain fresh topology
        this.interval = setInterval(() => {
            this.gossipPeerList();
        }, 30000); // Every 30s
        
        logger.info({ event: 'PEX_start' });
    }

    /**
     * Sends a PEER_EXCHANGE request to all active peers.
     */
    requestPeersFromAll() {
        const message = {
            type: 'PEER_EXCHANGE',
            requestingPeerId: this.localPeerId
        };
        this.connectionPool.broadcast(message);
    }

    /**
     * Sends a PEER_LIST of up to 20 known peers to the requester.
     * @param {string} requesterId 
     */
    #handleRequest(requesterId) {
        const peers = state.getPeerEntries()
            .filter(([id]) => id !== requesterId && id !== this.localPeerId)
            .slice(0, 20)
            .map(([id, info]) => ({
                peerId: id,
                host: info.host,
                port: info.port
            }));

        const response = {
            type: 'PEER_LIST',
            peers
        };

        this.connectionPool.send(requesterId, response);
        logger.debug({ event: 'PEX_response_sent', to: requesterId, count: peers.length });
    }

    /**
     * Processes a list of peers and attempts to connect to unknown ones.
     * @param {Array} peerList 
     */
    #handleResponse(peerList) {
        if (!Array.isArray(peerList)) return;

        peerList.forEach(peer => {
            if (peer.peerId !== this.localPeerId && !state.hasPeer(peer.peerId)) {
                logger.info({ event: 'PEX_new_peer_learned', peerId: peer.peerId });
                this.peerManager.addPeer(peer.peerId, peer.host, peer.port);
            }
        });
    }

    /**
     * Randomly picks an active peer and sends them our peer list.
     */
    gossipPeerList() {
        const activePeers = Array.from(this.connectionPool.outboundConnections.keys());
        if (activePeers.length === 0) return;

        const target = activePeers[Math.floor(Math.random() * activePeers.length)];
        this.#handleRequest(target);
    }

    stop() {
        if (this.interval) clearInterval(this.interval);
        logger.info({ event: 'PEX_stop' });
    }
}
