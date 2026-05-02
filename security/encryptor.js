import sodium from 'sodium-native';
import pino from 'pino';

const logger = pino({ name: 'encryptor' });

/**
 * Encryptor
 * 
 * Provides authenticated symmetric encryption (XSalsa20-Poly1305).
 * 
 * === NONCE UNIQUENESS ===
 * XSalsa20 is a stream cipher. A stream cipher generates a pseudo-random stream of 
 * bytes (the keystream) from the key and the nonce, which is then XOR'd with the 
 * plaintext. If the same nonce and key are used twice, the exact same keystream is 
 * generated. An attacker can XOR the two ciphertexts together to completely cancel 
 * out the keystream, recovering the XOR of the two plaintexts, which breaks the 
 * encryption. Nonces MUST be unique for every single message.
 * 
 * === TOPIC ENCRYPTION TRADEOFF ===
 * For 1-to-1 DMs, we derive a shared secret via X25519 ECDH.
 * For group/topic messages, we simplify by using a single Symmetric "Topic Key" 
 * that is distributed out-of-band or via encrypted direct messages.
 * 
 * Production Warning: This is a simplification. A true production system would 
 * implement the Signal Protocol's Double Ratchet, or Sender Keys (Message 
 * Franking/TreeKEM) to provide Perfect Forward Secrecy (PFS) and Post-Compromise 
 * Security (PCS). A static topic key means if a peer is compromised, all past 
 * and future messages are compromised until the key is rotated.
 */
export class Encryptor {
    /**
     * Encrypts a plaintext string using authenticated symmetric encryption.
     * 
     * @param {string} plaintext 
     * @param {Buffer} sharedSecret - The symmetric key (32 bytes)
     * @returns {{ ciphertext: string, nonce: string }} base64 encoded
     */
    static encrypt(plaintext, sharedSecret) {
        if (!sharedSecret || sharedSecret.length !== sodium.crypto_secretbox_KEYBYTES) {
            throw new Error('Invalid symmetric key size');
        }

        const plainBuffer = Buffer.from(plaintext, 'utf8');
        
        // Generate a random 24-byte nonce
        const nonce = Buffer.alloc(sodium.crypto_secretbox_NONCEBYTES);
        sodium.randombytes_buf(nonce);

        // Ciphertext will be longer than plaintext by the MAC size (16 bytes)
        const cipherBuffer = Buffer.alloc(plainBuffer.length + sodium.crypto_secretbox_MACBYTES);
        
        sodium.crypto_secretbox_easy(cipherBuffer, plainBuffer, nonce, sharedSecret);

        return {
            ciphertext: cipherBuffer.toString('base64'),
            nonce: nonce.toString('base64')
        };
    }

    /**
     * Decrypts an authenticated ciphertext.
     * 
     * @param {string} ciphertextBase64 
     * @param {string} nonceBase64 
     * @param {Buffer} sharedSecret - The symmetric key (32 bytes)
     * @returns {string} The decrypted plaintext string
     */
    static decrypt(ciphertextBase64, nonceBase64, sharedSecret) {
        if (!sharedSecret || sharedSecret.length !== sodium.crypto_secretbox_KEYBYTES) {
            throw new Error('Invalid symmetric key size');
        }

        const cipherBuffer = Buffer.from(ciphertextBase64, 'base64');
        const nonce = Buffer.from(nonceBase64, 'base64');
        
        if (nonce.length !== sodium.crypto_secretbox_NONCEBYTES) {
            throw new Error('Invalid nonce size');
        }

        // Plaintext will be smaller than ciphertext by the MAC size
        if (cipherBuffer.length < sodium.crypto_secretbox_MACBYTES) {
            throw new Error('Ciphertext too short');
        }
        
        const plainBuffer = Buffer.alloc(cipherBuffer.length - sodium.crypto_secretbox_MACBYTES);

        const success = sodium.crypto_secretbox_open_easy(plainBuffer, cipherBuffer, nonce, sharedSecret);
        
        if (!success) {
            logger.error({ event: 'decryption_failed', reason: 'mac_verification_failed' });
            throw new Error('Message authentication failed (wrong key or tampered data)');
        }

        return plainBuffer.toString('utf8');
    }
}
