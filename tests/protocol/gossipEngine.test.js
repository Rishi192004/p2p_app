import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GossipEngine } from '../../protocol/gossipEngine.js';
import { LamportClock } from '../../protocol/lamportClock.js';
import { EventEmitter } from 'node:events';
import collector from '../../metrics/collector.js';

test('GossipEngine', async (t) => {
    const mockConnectionPool = {
        outboundConnections: new Map(),
        inboundConnections: new Map(),
        broadcast: (msg, exclude) => {},
        getAllPeerIds: () => []
    };

    await t.test('receiveMessage should drop duplicates', () => {
        const clock = new LamportClock();
        const engine = new GossipEngine(mockConnectionPool, clock);
        const msg = { id: 'msg-1', sender: 'node-A', ttl: 5, lamportTimestamp: 1 };

        const beforeReceived = collector.getSnapshot().counters.messages_received_total || 0;
        const beforeDropped = collector.getSnapshot().counters.messages_dropped_duplicate || 0;

        engine.receiveMessage(msg, 'neighbor-1');
        assert.strictEqual(collector.getSnapshot().counters.messages_received_total, beforeReceived + 1);
        assert.strictEqual(collector.getSnapshot().counters.messages_dropped_duplicate || 0, beforeDropped);

        engine.receiveMessage(msg, 'neighbor-1');
        assert.strictEqual(collector.getSnapshot().counters.messages_received_total, beforeReceived + 2);
        assert.strictEqual(collector.getSnapshot().counters.messages_dropped_duplicate, beforeDropped + 1);
    });

    await t.test('receiveMessage should decrement TTL and forward', () => {
        let broadcastCalled = false;
        const pool = {
            outboundConnections: new Map([['p1', {}], ['p2', {}]]),
            inboundConnections: new Map(),
            broadcast: () => { broadcastCalled = true; },
            getAllPeerIds: () => ['p1', 'p2']
        };
        const clock = new LamportClock();
        const engine = new GossipEngine(pool, clock);
        const msg = { id: 'msg-2', sender: 'node-A', ttl: 10, lamportTimestamp: 1 };

        engine.receiveMessage(msg, 'neighbor-1');
        assert.strictEqual(msg.ttl, 9);
        assert.ok(broadcastCalled);
    });

    await t.test('receiveMessage should NOT forward if TTL is 0 after decrement', () => {
        let broadcastCalled = false;
        const pool = {
            outboundConnections: new Map([['p1', {}]]),
            inboundConnections: new Map(),
            broadcast: () => { broadcastCalled = true; },
            getAllPeerIds: () => ['p1']
        };
        const clock = new LamportClock();
        const engine = new GossipEngine(pool, clock);
        const msg = { id: 'msg-3', sender: 'node-A', ttl: 1, lamportTimestamp: 1 };

        engine.receiveMessage(msg, 'neighbor-1');
        assert.strictEqual(msg.ttl, 0);
        assert.ok(!broadcastCalled);
    });

    await t.test('receiveMessage should emit message:new for fresh messages', (t, done) => {
        const clock = new LamportClock();
        const engine = new GossipEngine(mockConnectionPool, clock);
        const msg = { id: 'msg-4', sender: 'node-A', ttl: 5, lamportTimestamp: 1 };

        engine.on('message:new', (received) => {
            assert.strictEqual(received.id, msg.id);
            done();
        });

        engine.receiveMessage(msg, 'neighbor-1');
    });

    await t.test('receiveMessage should update local Lamport clock', () => {
        const clock = new LamportClock();
        const engine = new GossipEngine(mockConnectionPool, clock);
        const msg = { id: 'msg-5', sender: 'node-A', ttl: 5, lamportTimestamp: 100 };

        engine.receiveMessage(msg, 'neighbor-1');
        assert.strictEqual(clock.value, 101);
    });
});
