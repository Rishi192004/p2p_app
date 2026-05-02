import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PendingQueue } from '../../protocol/pendingQueue.js';

test('PendingQueue', async (t) => {
    await t.test('should enqueue and flush messages for a peer', () => {
        const queue = new PendingQueue();
        const peerId = 'peer-1';
        const msg = { id: 'm1', content: 'test' };
        
        queue.enqueue(peerId, msg);
        const flushed = queue.flush(peerId);
        
        assert.strictEqual(flushed.length, 1);
        assert.deepStrictEqual(flushed[0], msg);
        assert.strictEqual(queue.flush(peerId).length, 0, 'Queue should be empty after flush');
    });

    await t.test('should handle multiple peers independently', () => {
        const queue = new PendingQueue();
        queue.enqueue('p1', { id: 'm1' });
        queue.enqueue('p2', { id: 'm2' });
        
        const f1 = queue.flush('p1');
        assert.strictEqual(f1.length, 1);
        assert.strictEqual(f1[0].id, 'm1');
        
        const f2 = queue.flush('p2');
        assert.strictEqual(f2.length, 1);
        assert.strictEqual(f2[0].id, 'm2');
    });

    await t.test('should respect maxQueueSize and drop oldest', () => {
        const queue = new PendingQueue(2);
        const p = 'p1';
        
        queue.enqueue(p, { id: '1' });
        queue.enqueue(p, { id: '2' });
        queue.enqueue(p, { id: '3' }); // Should drop '1'
        
        const flushed = queue.flush(p);
        assert.strictEqual(flushed.length, 2);
        assert.strictEqual(flushed[0].id, '2');
        assert.strictEqual(flushed[1].id, '3');
    });
});
