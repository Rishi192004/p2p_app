import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TopicRouter } from '../../protocol/topicRouter.js';

test('TopicRouter', async (t) => {
    await t.test('should support direct subscriptions (0-hop)', () => {
        const router = new TopicRouter();
        router.subscribe('peer-1', 'sports');

        const peers = router.getPeersForTopic('sports');
        assert.ok(peers.has('peer-1'));
        assert.strictEqual(peers.size, 1);
    });

    await t.test('should support direct unsubscribe', () => {
        const router = new TopicRouter();
        router.subscribe('peer-1', 'sports');
        router.unsubscribe('peer-1', 'sports');

        const peers = router.getPeersForTopic('sports');
        assert.strictEqual(peers.size, 0);
    });

    await t.test('should update route and select shortest path', () => {
        const router = new TopicRouter();
        
        // 1. Initial 2-hop route via peer-B
        router.updateRoute('sports', 'peer-A', 'peer-B', 2, 1, ['peer-B'], Infinity);
        
        let peers = router.getPeersForTopic('sports');
        assert.ok(peers.has('peer-B'));
        assert.strictEqual(peers.size, 1);

        // 2. Shorter 1-hop route via peer-C (same sequence number)
        const updated = router.updateRoute('sports', 'peer-A', 'peer-C', 1, 1, [], Infinity);
        assert.ok(updated, 'Route should be updated for shorter path');

        peers = router.getPeersForTopic('sports');
        assert.ok(peers.has('peer-C'));
        assert.ok(!peers.has('peer-B'), 'Old nextHop should no longer be chosen for sports');
        assert.strictEqual(peers.size, 1);

        // 3. Stale update with lower sequence number should be ignored
        const staleUpdated = router.updateRoute('sports', 'peer-A', 'peer-D', 0, 0, [], Infinity);
        assert.ok(!staleUpdated, 'Stale update should be ignored');

        peers = router.getPeersForTopic('sports');
        assert.ok(peers.has('peer-C'));
        assert.strictEqual(peers.size, 1);
    });

    await t.test('should clear routes when peer disconnects', () => {
        const router = new TopicRouter();

        // Node-A is subscribed to sports, nextHop is Peer-B (1 hop away)
        router.updateRoute('sports', 'Node-A', 'Peer-B', 1, 1, [], Infinity);
        // Node-C is subscribed to music, nextHop is Peer-B (2 hops away)
        router.updateRoute('music', 'Node-C', 'Peer-B', 2, 1, ['Peer-B'], Infinity);
        // Node-D is subscribed to global, nextHop is Peer-E (1 hop away)
        router.updateRoute('global', 'Node-D', 'Peer-E', 1, 1, [], Infinity);

        router.clearRoutesForPeer('Peer-B');

        assert.strictEqual(router.getPeersForTopic('sports').size, 0, 'Routes via Peer-B should be cleared');
        assert.strictEqual(router.getPeersForTopic('music').size, 0, 'Routes via Peer-B should be cleared');
        assert.strictEqual(router.getPeersForTopic('global').size, 1, 'Routes via Peer-E should remain');
    });

    await t.test('should garbage collect expired soft-state routes', () => {
        const router = new TopicRouter();
        const now = 10000;

        // Route expires at 15000
        router.updateRoute('sports', 'Node-A', 'Peer-B', 1, 1, [], 15000);
        // Route expires at 8000
        router.updateRoute('music', 'Node-C', 'Peer-D', 1, 1, [], 8000);

        // Run GC at 9000 -> music expires, sports remains
        router.gc(9000);
        assert.strictEqual(router.getPeersForTopic('music', 9000).size, 0);
        assert.strictEqual(router.getPeersForTopic('sports', 9000).size, 1);

        // Run GC at 16000 -> sports also expires
        router.gc(16000);
        assert.strictEqual(router.getPeersForTopic('sports', 16000).size, 0);
    });
});
