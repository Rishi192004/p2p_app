import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PeerManager } from '../../node/peerManager.js';
import state from '../../node/state.js';

test('PeerManager', async (t) => {
    const mockPool = {
        connect: () => {},
        disconnect: () => {}
    };

    await t.test('addPeer should register and initiate connection', () => {
        const pm = new PeerManager(mockPool);
        pm.addPeer('p1', 'localhost', 8080);
        
        const peer = state.getPeer('p1');
        assert.ok(peer);
        assert.strictEqual(peer.status, 'CONNECTING');
    });

    await t.test('updateHeartbeat should transition status and emit recovered', (t, done) => {
        const pm = new PeerManager(mockPool);
        state.setPeer('p2', { status: 'SUSPECTED', lastSeen: 0, lamportTime: 0 });
        
        pm.on('peer:recovered', (data) => {
            assert.strictEqual(data.peerId, 'p2');
            assert.strictEqual(state.getPeer('p2').status, 'ACTIVE');
            done();
        });

        pm.updateHeartbeat('p2', 10);
    });
});
