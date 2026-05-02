import mdns from 'mdns-js';
import { createLogger } from '../../utils/logger.js';

const logger = createLogger('mdnsDiscovery');

/**
 * mDNS Discovery
 * 
 * LAN-only discovery mechanism using Multicast DNS.
 * Zero-config, zero-infrastructure solution for local networks.
 * 
 * === LAN DISCOVERY TRADEOFF ===
 * mDNS is perfect for local office/home networks where peers are on the 
 * same subnet. It bypasses the need for any central bootstrap nodes. 
 * However, mDNS does not traverse the public internet (WAN) or corporate 
 * firewalls that block multicast traffic.
 */
export class MDNSDiscovery {
    constructor(peerManager, localPeerId, port) {
        this.peerManager = peerManager;
        this.localPeerId = localPeerId;
        this.port = port;
        this.serviceType = '_p2pchat._tcp';
        this.ad = null;
        this.browser = null;
    }

    start() {
        // 1. Advertise our presence
        try {
            this.ad = mdns.createAdvertisement(this.serviceType, this.port, {
                name: this.localPeerId,
                txt: {
                    peerId: this.localPeerId,
                    port: this.port.toString()
                }
            });
            this.ad.start();
            logger.info({ event: 'mDNS_advertise_start', peerId: this.localPeerId, port: this.port });
        } catch (err) {
            logger.error({ event: 'mDNS_advertise_error', error: err.message });
        }

        // 2. Browse for other peers
        try {
            this.browser = mdns.createBrowser(mdns.tcp(this.serviceType));
            
            this.browser.on('ready', () => {
                this.browser.discover();
            });

            this.browser.on('update', (data) => {
                // Ignore self-discovery and malformed data
                if (!data || !data.txt) return;
                
                const txt = data.txt.reduce((acc, curr) => {
                    const [key, val] = curr.split('=');
                    acc[key] = val;
                    return acc;
                }, {});

                const peerId = txt.peerId;
                const port = parseInt(txt.port);
                const host = data.addresses[0];

                if (peerId && peerId !== this.localPeerId && host && port) {
                    logger.info({ event: 'mDNS_peer_discovered', peerId, host, port });
                    this.peerManager.addPeer(peerId, host, port);
                }
            });

            logger.info({ event: 'mDNS_browse_start' });
        } catch (err) {
            logger.error({ event: 'mDNS_browse_error', error: err.message });
        }
    }

    stop() {
        if (this.ad) this.ad.stop();
        if (this.browser) this.browser.stop();
        logger.info({ event: 'mDNS_stop' });
    }
}
