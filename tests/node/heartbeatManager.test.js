import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HeartbeatManager } from '../../node/heartbeatManager.js';
import { PeerManager } from '../../node/peerManager.js';
import state from '../../node/state.js';
import config from '../../config/default.js';

test('HeartbeatManager', async (t) => {
    const mockPool = {
        outboundConnections: new Map(),
        broadcast: () => {},
        disconnect: () => {}
    };
    const pm = new PeerManager(mockPool);
    const hm = new HeartbeatManager('local-node', mockPool, pm);

    await t.test('should mark peer as SUSPECTED on timeout', (t, done) => {
        const peerId = 'slow-peer';
        state.setPeer(peerId, { status: 'ACTIVE', lastSeen: Date.now() - config.PEER_TIMEOUT_MS - 500, host: '127.0.0.1', port: 9000 });
        
        hm.on('peer:suspected', (data) => {
            assert.strictEqual(data.peerId, peerId);
            assert.strictEqual(state.getPeer(peerId).status, 'SUSPECTED');
            done();
        });

        hm._tick();
    });

    await t.test('should mark SUSPECTED peer as DEAD on second timeout', (t, done) => {
        const peerId = 'dead-peer';
        state.setPeer(peerId, { status: 'SUSPECTED', lastSeen: Date.now() - (2 * config.PEER_TIMEOUT_MS) - 500, host: '127.0.0.1', port: 9001 });
        
        hm._tick();
        assert.ok(!state.hasPeer(peerId), 'Peer should be removed from state');
        done();
    });
});
