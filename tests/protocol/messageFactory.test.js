import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MessageFactory } from '../../protocol/messageFactory.js';
import { validate as isUuid } from 'uuid';
import config from '../../config/default.js';

test('MessageFactory', async (t) => {
    /**
     * System Design Reason: Tests act as executable documentation and guardrails.
     * Here we verify the factory strictly adheres to the defined schema and defaults.
     */

    await t.test('createChat should generate a valid schema compliant CHAT message', () => {
        const sender = 'peer-123';
        const payload = 'Hello world!';
        const msg = MessageFactory.createChat(sender, payload);

        // Core schema validations
        assert.ok(isUuid(msg.id), 'Message ID should be a valid UUIDv4');
        assert.strictEqual(msg.type, 'CHAT');
        assert.strictEqual(msg.sender, sender);
        assert.strictEqual(msg.payload, payload);
        assert.strictEqual(msg.topic, 'global', 'Topic should default to global');
        assert.strictEqual(msg.ttl, config.MAX_TTL, 'TTL should default to MAX_TTL from config');
        
        // Validate Lamport Clock & Timestamps
        assert.ok(typeof msg.lamportTimestamp === 'number' && msg.lamportTimestamp > 0);
        assert.ok(!isNaN(Date.parse(msg.createdAt)), 'createdAt should be a valid ISO string');
    });

    await t.test('createAck should generate an ACK with low TTL and correct payload', () => {
        const sender = 'peer-456';
        const targetMsgId = 'some-uuid-here';
        const msg = MessageFactory.createAck(sender, targetMsgId);

        assert.strictEqual(msg.type, 'ACK');
        assert.strictEqual(msg.ttl, 2, 'ACK TTL should be low to prevent network flooding');
        
        const parsedPayload = JSON.parse(msg.payload);
        assert.strictEqual(parsedPayload.ackId, targetMsgId);
    });

    await t.test('createHeartbeat should generate a HEARTBEAT with ttl 1', () => {
        const sender = 'peer-789';
        const msg = MessageFactory.createHeartbeat(sender);

        assert.strictEqual(msg.type, 'HEARTBEAT');
        assert.strictEqual(msg.ttl, 1, 'HEARTBEAT TTL should be exactly 1 hop');
        assert.strictEqual(msg.payload, 'ping');
    });

    await t.test('Logical clock should strictly increase', () => {
        const msg1 = MessageFactory.createHeartbeat('p1');
        const msg2 = MessageFactory.createHeartbeat('p1');
        
        assert.ok(msg2.lamportTimestamp > msg1.lamportTimestamp, 'Logical clock must increment between messages');
    });
});
