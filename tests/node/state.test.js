import { test } from 'node:test';
import assert from 'node:assert/strict';
import state from '../../node/state.js';

test('Node State', async (t) => {
    await t.test('should manage peers correctly', () => {
        const peerId = 'peer-1';
        const info = { status: 'ACTIVE' };
        state.setPeer(peerId, info);
        assert.strictEqual(state.getPeer(peerId), info);
        assert.strictEqual(state.getPeerCount(), 1);
        assert.strictEqual(state.getActivePeerCount(), 1);
        
        state.deletePeer(peerId);
        assert.strictEqual(state.getPeerCount(), 0);
    });

    await t.test('should cleanup seen messages when limit reached', () => {
        // Reset or use the singleton
        // We fill it up
        for (let i = 0; i < 10001; i++) {
            state.addSeenMessage(`msg-${i}`);
        }
        // Cleanup happens at size > 10,000 (so 10,001)
        // It removes 1,000. 10,001 - 1,000 = 9,001
        assert.strictEqual(state.hasSeenMessage('msg-10000'), true);
        assert.strictEqual(state._seenMessages.size, 9001);
    });
});
