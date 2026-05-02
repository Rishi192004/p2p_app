import test from 'node:test';
import assert from 'node:assert';
import { KeyManager } from '../../security/keyManager.js';
import { Encryptor } from '../../security/encryptor.js';
import { SecurityManager } from '../../security/index.js';
import fs from 'fs/promises';
import path from 'path';

test('KeyManager - generates and persists keys', async (t) => {
    const testDir = './storage/test_keys';
    // Cleanup previous test
    await fs.rm(testDir, { recursive: true, force: true });
    
    const km = new KeyManager(testDir);
    await km.init();
    
    const pk = km.getPublicKey();
    assert.ok(pk, 'Public key should be generated');
    
    const signKeyExists = await fs.access(path.join(testDir, 'sign.key')).then(() => true).catch(() => false);
    assert.ok(signKeyExists, 'Sign key should be persisted');
    
    // Test persistence: loading existing keys
    const km2 = new KeyManager(testDir);
    await km2.init();
    assert.strictEqual(km2.getPublicKey(), pk, 'Should load the same public key');
    
    await fs.rm(testDir, { recursive: true, force: true });
});

test('Encryptor - XSalsa20-Poly1305 encryption/decryption', async (t) => {
    const km = new KeyManager();
    await km.init();
    
    const sharedSecret = km.deriveSharedSecret(km.getBoxPublicKey());
    const plaintext = 'Hello Security!';
    
    const { ciphertext, nonce } = Encryptor.encrypt(plaintext, sharedSecret);
    assert.notStrictEqual(ciphertext, plaintext, 'Ciphertext should not match plaintext');
    
    const decrypted = Encryptor.decrypt(ciphertext, nonce, sharedSecret);
    assert.strictEqual(decrypted, plaintext, 'Decrypted text should match original');
});

test('SecurityManager - signs and verifies messages', async (t) => {
    const sm = new SecurityManager();
    await sm.init();
    
    const peerId = 'peer-1';
    const pk = sm.keyManager.getPublicKey();
    sm.registerPeerKey(peerId, pk);
    
    const msg = {
        id: 'msg-1',
        type: 'CHAT',
        sender: peerId,
        topic: 'global',
        payload: 'Secret payload'
    };
    
    sm.signOutgoingMessage(msg);
    assert.ok(msg.signature, 'Message should be signed');
    
    const isValid = sm.verifyIncomingMessage(msg);
    assert.ok(isValid, 'Valid signature should be verified');
    
    // Tamper with payload
    msg.payload = 'Tampered payload';
    const isInvalid = sm.verifyIncomingMessage(msg);
    assert.strictEqual(isInvalid, false, 'Tampered message should fail verification');
});
