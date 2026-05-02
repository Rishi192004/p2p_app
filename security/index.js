import { KeyManager } from './keyManager.js';
import { Encryptor } from './encryptor.js';
import { createLogger } from '../utils/logger.js';
import collector from '../metrics/collector.js';

const logger = createLogger('security');

/**
 * Security Integration Module
 * 
 * === SECURITY MODEL ===
 * What this PROTECTS against:
 * 1. Impersonation: A peer cannot forge a message claiming to be from someone else, 
 *    because they lack the private Ed25519 key.
 * 2. Tampering (Man-in-the-Middle): A forwarding node cannot alter the payload of a 
 *    gossiped message. Any modification invalidates the digital signature.
 * 
 * What this DOES NOT protect against:
 * 1. Traffic Analysis: Observers can still see who is talking to whom, the size 
 *    of the payloads, and the topic routing metadata.
 * 2. Node Compromise: If an attacker gains physical or remote execution access to a 
 *    peer's machine, the private keys and plaintext are fully exposed.
 * 
 * === WHY NO "FORWARDING" ENCRYPTION? ===
 * We do not E2E encrypt the gossip routing metadata (like TTL, topic, or message ID).
 * Forwarded messages are already digitally signed by the originator. A forwarding 
 * peer cannot modify the payload without invalidating the signature. Encrypting the 
 * outer layer of gossip between every hop (TLS aside) is unnecessary overhead 
 * because the integrity is already mathematically guaranteed by the signature.
 * 
 * === THREAT MODEL ===
 * 1. Sybil Attacks:
 *    Since anyone can generate an unlimited number of cryptographic identities 
 *    (KeyManager generates locally), an attacker can flood the network with 
 *    thousands of fake peers ("Sybils").
 *    Mitigation: This architecture requires a future addition of Proof-of-Work (PoW) 
 *    for identity creation, a Web of Trust (where peers vouch for each other), or 
 *    Trusted Bootstrap Nodes to rate-limit or authenticate network entry.
 * 
 * 2. Eclipse Attacks:
 *    An attacker controls all inbound/outbound connections of a victim node, 
 *    isolating them into a fake, malicious subgraph.
 *    Mitigation: Nodes must enforce diversity in their connection pool, preferring 
 *    long-lived connections, and verifying network health across multiple independent 
 *    bootstrappers.
 */
export class SecurityManager {
    constructor() {
        this.keyManager = new KeyManager();
        
        // Maps peerId to their base64 public key (learned during HELLO handshake)
        this.peerPublicKeys = new Map();
    }

    async init() {
        await this.keyManager.init();
        logger.info({ event: 'security_manager_initialized' });
    }

    /**
     * Registers a peer's public key (called when processing a HELLO message)
     * @param {string} peerId 
     * @param {string} publicKeyBase64 
     */
    registerPeerKey(peerId, publicKeyBase64) {
        this.peerPublicKeys.set(peerId, publicKeyBase64);
        logger.debug({ event: 'peer_key_registered', peerId });
    }

    /**
     * Signs an outgoing message in place.
     * @param {Object} message 
     */
    signOutgoingMessage(message) {
        // We sign the core payload and metadata to prevent tampering
        const payloadToSign = JSON.stringify({
            id: message.id,
            type: message.type,
            sender: message.sender,
            topic: message.topic,
            payload: message.payload
        });

        message.signature = this.keyManager.sign(payloadToSign);
    }

    /**
     * Verifies an incoming message's signature.
     * @param {Object} message 
     * @returns {boolean} True if valid, false if invalid or key unknown.
     */
    verifyIncomingMessage(message) {
        if (!message.signature) {
            collector.increment('invalid_signature_count');
            logger.warn({ event: 'signature_missing', id: message.id, sender: message.sender });
            return false;
        }

        const senderPublicKey = this.peerPublicKeys.get(message.sender);
        if (!senderPublicKey) {
            // In a real P2P system, we might ask the network for the key, 
            // but for simplicity, if we don't have it, we can't verify.
            // A node must send HELLO (or PEER_EXCHANGE must include it).
            logger.warn({ event: 'public_key_unknown', sender: message.sender });
            return false;
        }

        const payloadToVerify = JSON.stringify({
            id: message.id,
            type: message.type,
            sender: message.sender,
            topic: message.topic,
            payload: message.payload
        });

        const isValid = this.keyManager.verify(payloadToVerify, message.signature, senderPublicKey);
        
        if (!isValid) {
            collector.increment('invalid_signature_count');
            logger.error({ event: 'signature_invalid', id: message.id, sender: message.sender });
        }

        return isValid;
    }
}

// Export a singleton or just the classes depending on app design
export { KeyManager, Encryptor };
