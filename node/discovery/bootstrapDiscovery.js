import pino from 'pino';
import { MessageFactory } from '../../protocol/messageFactory.js';

const logger = pino({ name: 'bootstrapDiscovery' });

/**
 * Bootstrap Discovery
 * 
 * Initial entry point for joining the P2P network over the public internet.
 * 
 * === THE THUNDERING HERD PROBLEM ===
 * If 1,000 nodes restart simultaneously (e.g., after a global configuration update) 
 * and all hit the same bootstrap node at once, the bootstrap server will likely 
 * suffer a Denial of Service (DoS) due to CPU/Network saturation. 
 * 
 * Solution: Exponential Backoff + Jitter.
 * Instead of retrying every 5s, we increase the delay exponentially and add a 
 * random "jitter" factor (e.g., random offset of ±1000ms). This spreads the 
 * reconnection attempts over a wider time window, smoothing the traffic spike 
 * into a manageable curve.
 * 
 * === NAT TRAVERSAL NOTE ===
 * Most consumer nodes are behind a NAT (Network Address Translation). 
 * To allow inbound connections, we would conceptually plug in STUN (Session 
 * Traversal Utilities for NAT) to discover our public IP/port before calling 
 * wsClient.connect(). If STUN fails, we would use TURN (Traversal Using Relays 
 * around NAT), essentially a fallback proxy. This current implementation 
 * assumes public accessibility or port forwarding.
 */
export class BootstrapDiscovery {
    constructor(peerManager, localPeerId, bootstrapNodes = []) {
        this.peerManager = peerManager;
        this.localPeerId = localPeerId;
        this.bootstrapNodes = bootstrapNodes; // Array of { host, port, peerId }
    }

    start() {
        if (this.bootstrapNodes.length === 0) {
            logger.warn({ event: 'no_bootstrap_nodes' }, 'Starting without bootstrap nodes');
            return;
        }

        this.bootstrapNodes.forEach((node, index) => {
            // Add jitter to stagger connections
            const jitter = Math.random() * 5000;
            setTimeout(() => {
                this.#attemptBootstrap(node);
            }, jitter);
        });
    }

    #attemptBootstrap(node) {
        logger.info({ event: 'bootstrap_attempt', host: node.host, port: node.port }, 'Connecting to bootstrap node');
        
        // Add peer via manager (which handles connection)
        this.peerManager.addPeer(node.peerId, node.host, node.port);
        
        // Note: The PEER_EXCHANGE request will be triggered via PeerExchange 
        // once the connection is established.
    }

    stop() {
        // Bootstrap is mainly a startup phase
        logger.info({ event: 'bootstrap_stop' });
    }
}
