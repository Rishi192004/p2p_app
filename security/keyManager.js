import sodium from 'sodium-native';
import fs from 'fs/promises';
import path from 'path';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('keyManager');

/**
 * Key Manager
 * 
 * Handles the generation, persistence, and basic operations of cryptographic keys.
 * 
 * === ED25519 VS RSA ===
 * We use Ed25519 for digital signatures instead of RSA. 
 * Why? RSA requires extremely large keys (e.g., 2048 or 4096 bits) to be secure, 
 * which bloats the payload of every single gossip message. Ed25519 provides 
 * equivalent security with tiny 32-byte public keys and 64-byte signatures. 
 * It is also significantly faster to sign and verify, which is critical in a 
 * high-throughput P2P gossip network where every node verifies every message.
 */
export class KeyManager {
    constructor(keysDir = './storage/keys') {
        this.keysDir = keysDir;
        
        // Signing keys (Ed25519)
        this.signPublicKey = Buffer.alloc(sodium.crypto_sign_PUBLICKEYBYTES);
        this.signSecretKey = Buffer.alloc(sodium.crypto_sign_SECRETKEYBYTES);
        
        // Encryption keys (X25519)
        this.boxPublicKey = Buffer.alloc(sodium.crypto_box_PUBLICKEYBYTES);
        this.boxSecretKey = Buffer.alloc(sodium.crypto_box_SECRETKEYBYTES);
    }

    /**
     * Initializes the key manager. Loads keys from disk or generates them.
     */
    async init() {
        try {
            await fs.mkdir(this.keysDir, { recursive: true });
            
            const signSecretPath = path.join(this.keysDir, 'sign.key');
            const boxSecretPath = path.join(this.keysDir, 'box.key');

            try {
                // Try to load existing keys
                const savedSignSecret = await fs.readFile(signSecretPath);
                const savedBoxSecret = await fs.readFile(boxSecretPath);
                
                savedSignSecret.copy(this.signSecretKey);
                savedBoxSecret.copy(this.boxSecretKey);
                
                // Derive public keys from secret keys
                // For Ed25519, the secret key contains the public key in the second half, 
                // but we can extract or regenerate it. Actually, `crypto_sign_seed_keypair` is better 
                // or we can just use `crypto_sign_ed25519_sk_to_pk`.
                sodium.crypto_sign_ed25519_sk_to_pk(this.signPublicKey, this.signSecretKey);
                sodium.crypto_scalarmult_base(this.boxPublicKey, this.boxSecretKey);
                
                logger.info({ event: 'keys_loaded' });
            } catch (err) {
                // If keys don't exist, generate new ones
                logger.info({ event: 'generating_new_keys' });
                
                sodium.crypto_sign_keypair(this.signPublicKey, this.signSecretKey);
                sodium.crypto_box_keypair(this.boxPublicKey, this.boxSecretKey);

                // Persist with restrictive permissions (chmod 600 equivalent)
                await fs.writeFile(signSecretPath, this.signSecretKey, { mode: 0o600 });
                await fs.writeFile(boxSecretPath, this.boxSecretKey, { mode: 0o600 });
            }
        } catch (error) {
            logger.error({ event: 'key_manager_init_error', error: error.message });
            throw error;
        }
    }

    /**
     * Returns the base64 encoded public key used for signing.
     * @returns {string}
     */
    getPublicKey() {
        return this.signPublicKey.toString('base64');
    }

    /**
     * Returns the base64 encoded public key used for X25519 ECDH.
     * @returns {string}
     */
    getBoxPublicKey() {
        return this.boxPublicKey.toString('base64');
    }

    /**
     * Signs a message payload.
     * @param {string} message - The plaintext message or JSON string.
     * @returns {string} base64 signature
     */
    sign(message) {
        const msgBuffer = Buffer.from(message, 'utf8');
        const signature = Buffer.alloc(sodium.crypto_sign_BYTES);
        
        sodium.crypto_sign_detached(signature, msgBuffer, this.signSecretKey);
        
        return signature.toString('base64');
    }

    /**
     * Verifies a signature against a message and a public key.
     * @param {string} message 
     * @param {string} signatureBase64 
     * @param {string} senderPublicKeyBase64 
     * @returns {boolean}
     */
    verify(message, signatureBase64, senderPublicKeyBase64) {
        try {
            const msgBuffer = Buffer.from(message, 'utf8');
            const signature = Buffer.from(signatureBase64, 'base64');
            const pk = Buffer.from(senderPublicKeyBase64, 'base64');
            
            if (signature.length !== sodium.crypto_sign_BYTES) return false;
            if (pk.length !== sodium.crypto_sign_PUBLICKEYBYTES) return false;

            return sodium.crypto_sign_verify_detached(signature, msgBuffer, pk);
        } catch (err) {
            return false;
        }
    }

    /**
     * Derives a shared symmetric secret using X25519 ECDH.
     * @param {string} theirBoxPublicKeyBase64 
     * @returns {Buffer} The derived shared secret (rx/tx keys)
     */
    deriveSharedSecret(theirBoxPublicKeyBase64) {
        const theirPk = Buffer.from(theirBoxPublicKeyBase64, 'base64');
        const sharedSecret = Buffer.alloc(sodium.crypto_scalarmult_BYTES);
        
        sodium.crypto_scalarmult(sharedSecret, this.boxSecretKey, theirPk);
        
        // We hash the shared secret to create a robust symmetric key
        const symmetricKey = Buffer.alloc(sodium.crypto_aead_xchacha20poly1305_ietf_KEYBYTES);
        sodium.crypto_generichash(symmetricKey, sharedSecret);
        
        return symmetricKey;
    }
}
