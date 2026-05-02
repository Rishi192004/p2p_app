import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AckManager } from '../../protocol/ackManager.js';
import { LamportClock } from '../../protocol/lamportClock.js';

test('AckManager', async (t) => {
    const createMockPool = () => {
        return {
            outboundConnections: new Map([
                ['p1', { isConnected: true, send: (m) => m.receivedBy = (m.receivedBy || []).concat('p1') }],
                ['p2', { isConnected: true, send: (m) => m.receivedBy = (m.receivedBy || []).concat('p2') }]
            ]),
            broadcast: (msg, exclude) => {}
        };
    };

    await t.test('sendWithAck should transmit and track message', () => {
        const pool = createMockPool();
        const clock = new LamportClock();
        const ackMgr = new AckManager(pool, clock);
        const msg = { id: 'm1' };

        ackMgr.sendWithAck(msg, ['p1', 'p2']);

        assert.strictEqual(msg.receivedBy.length, 2);
        assert.ok(ackMgr.pendingAcks.has('m1'));
        assert.strictEqual(ackMgr.pendingAcks.get('m1').peers.size, 2);
        
        // Clean up timer
        clearTimeout(ackMgr.pendingAcks.get('m1').timer);
    });

    await t.test('receiveAck should confirm delivery when all peers ack', (t, done) => {
        const pool = createMockPool();
        const clock = new LamportClock();
        const ackMgr = new AckManager(pool, clock);
        const msg = { id: 'm1' };

        ackMgr.on('delivery:confirmed', (msgId) => {
            assert.strictEqual(msgId, 'm1');
            assert.ok(!ackMgr.pendingAcks.has('m1'));
            done();
        });

        ackMgr.sendWithAck(msg, ['p1', 'p2']);

        ackMgr.receiveAck({ sender: 'p1', payload: JSON.stringify({ ackId: 'm1' }) });
        ackMgr.receiveAck({ sender: 'p2', payload: JSON.stringify({ ackId: 'm1' }) });
    });

    await t.test('should emit delivery:failed after max retries', (t, done) => {
        // We can shorten timeout for test
        const pool = createMockPool();
        const clock = new LamportClock();
        const ackMgr = new AckManager(pool, clock);
        const msg = { id: 'm_fail' };

        // Mock config for faster test
        // Actually we just wait for the timer
        // Let's use a smaller timeout if possible, or just mock the timer logic
        
        ackMgr.on('delivery:failed', (data) => {
            assert.strictEqual(data.messageId, 'm_fail');
            done();
        });

        // Speed up the timer by overriding _startTimer or just triggering timeout manually
        ackMgr.sendWithAck(msg, ['p1']);
        
        // Manually trigger timeouts
        const entry = ackMgr.pendingAcks.get('m_fail');
        clearTimeout(entry.timer);
        
        // Simulate retries
        ackMgr._handleTimeout('m_fail'); // attempt 2
        clearTimeout(ackMgr.pendingAcks.get('m_fail').timer);
        
        ackMgr._handleTimeout('m_fail'); // attempt 3
        clearTimeout(ackMgr.pendingAcks.get('m_fail').timer);
        
        ackMgr._handleTimeout('m_fail'); // attempt 4 -> fails
    });
});
