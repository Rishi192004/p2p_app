import test from 'node:test';
import assert from 'node:assert/strict';
import { PeerExchange } from '../../node/discovery/peerExchange.js';
import { EventEmitter } from 'events';

test('PeerExchange - handles PEER_EXCHANGE and PEER_LIST', async (t) => {
    const mockPeerManager = { addPeer: () => {} };
    const mockPool = new EventEmitter();
    mockPool.send = () => {};
    mockPool.broadcast = () => {};
    mockPool.outboundConnections = new Map();

    const pex = new PeerExchange(mockPeerManager, mockPool, 'local-id');
    pex.start();

    await t.test('should handle PEER_EXCHANGE request and respond with PEER_LIST', (t, done) => {
        const requesterId = 'peer-B';
        
        mockPool.send = (peerId, message) => {
            assert.strictEqual(peerId, requesterId);
            assert.strictEqual(message.type, 'PEER_LIST');
            assert.ok(Array.isArray(message.peers));
            done();
        };

        mockPool.emit('message:received', { type: 'PEER_EXCHANGE' }, requesterId);
    });

    await t.test('should handle PEER_LIST response and add unknown peers', () => {
        let addedPeerId = null;
        mockPeerManager.addPeer = (id) => { addedPeerId = id; };

        const peerList = [{ peerId: 'new-peer', host: '1.2.3.4', port: 9000 }];
        mockPool.emit('message:received', { type: 'PEER_LIST', peers: peerList }, 'some-peer');

        assert.strictEqual(addedPeerId, 'new-peer');
    });

    pex.stop();
});
