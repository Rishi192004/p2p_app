import { createLogger } from '../../utils/logger.js';
import { MDNSDiscovery } from './mdnsDiscovery.js';
import { BootstrapDiscovery } from './bootstrapDiscovery.js';
import { PeerExchange } from './peerExchange.js';

const logger = createLogger('discovery');

/**
 * Discovery Orchestrator
 * 
 * Manages the lifecycle and ordering of all peer discovery mechanisms.
 */
export class Discovery {
    constructor(peerManager, connectionPool, options = {}) {
        this.peerManager = peerManager;
        this.connectionPool = connectionPool;
        
        this.localPeerId = options.localPeerId;
        this.port = options.port;
        this.bootstrapNodes = options.bootstrapNodes || [];

        this.mdns = new MDNSDiscovery(this.peerManager, this.localPeerId, this.port);
        this.bootstrap = new BootstrapDiscovery(this.peerManager, this.localPeerId, this.bootstrapNodes);
        this.pex = new PeerExchange(this.peerManager, this.connectionPool, this.localPeerId);
        this.pexTimeout = null;
    }

    /**
     * Starts discovery in a layered order:
     * 1. mDNS (Instant LAN connectivity)
     * 2. Bootstrap (Internet entry point)
     * 3. Peer Exchange (Topology expansion)
     */
    start() {
        logger.info({ event: 'discovery_start' }, 'Starting layered discovery system');
        
        // 1. LAN Discovery (mDNS)
        this.mdns.start();

        // 2. Internet Discovery (Bootstrap)
        this.bootstrap.start();

        // 3. Topology Management (Peer Exchange)
        this.pex.start();
        
        // Initial PEX request to expand network quickly
        this.pexTimeout = setTimeout(() => {
            this.pex.requestPeersFromAll();
        }, 5000);
    }

    stop() {
        if (this.pexTimeout) {
            clearTimeout(this.pexTimeout);
            this.pexTimeout = null;
        }
        this.mdns.stop();
        this.bootstrap.stop();
        this.pex.stop();
        logger.info({ event: 'discovery_stop' });
    }
}
