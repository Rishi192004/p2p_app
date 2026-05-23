import test from 'node:test';
import assert from 'node:assert';
import { MemoryLevel } from 'memory-level';
import { MessageStore } from '../../storage/messageStore.js';
import { SyncManager } from '../../storage/syncManager.js';
import { MessageFactory } from '../../protocol/messageFactory.js';
import { GossipEngine } from '../../protocol/gossipEngine.js';

test('MessageStore - saves and retrieves by topic', async (t) => {
    const db = new MemoryLevel();
    const store = new MessageStore(db);

    const msg1 = MessageFactory.createChat('peerA', 'hello', 'global');
    // Manually adjust lamport timestamp to ensure ordering
    msg1.lamportTimestamp = 10;
    
    const msg2 = MessageFactory.createChat('peerB', 'world', 'global');
    msg2.lamportTimestamp = 20;

    await store.save(msg1);
    await store.save(msg2);

    await store.flush();

    // since timestamp 15, should only get msg2
    const results = await store.getByTopic('global', 15);
    
    assert.strictEqual(results.length, 1);
    assert.strictEqual(results[0].id, msg2.id);
});

test('MessageStore - getById', async (t) => {
    const db = new MemoryLevel();
    const store = new MessageStore(db);

    const msg = MessageFactory.createChat('peerA', 'test-id', 'global');
    await store.save(msg);
    await store.flush();

    const result = await store.getById(msg.id);
    assert.notStrictEqual(result, null);
    assert.strictEqual(result.id, msg.id);
});

test('SyncManager - onPeerReconnected triggers sync burst', async (t) => {
    const db = new MemoryLevel();
    const store = new MessageStore(db);

    let sentMessage = null;
    let sentToPeer = null;

    const mockConnectionPool = {
        send: (peerId, msg) => {
            sentToPeer = peerId;
            sentMessage = msg;
        }
    };
    const mockGossipEngine = {
        topicRouter: {
            getTopicsForPeer: (peerId) => ['global']
        }
    };

    const syncManager = new SyncManager(db, store, mockGossipEngine, mockConnectionPool);

    // Setup: Peer C missed a message
    await syncManager.updateLastSeenLamport('peerC', 5);

    const msg = MessageFactory.createChat('peerA', 'missed', 'global');
    msg.lamportTimestamp = 10;
    await store.save(msg);
    await store.flush();

    // Action: Peer C reconnects
    await syncManager.onPeerReconnected('peerC');

    // Verification: should send a SYNC_BATCH
    assert.strictEqual(sentToPeer, 'peerC');
    assert.strictEqual(sentMessage.type, 'SYNC_BATCH');
    
    const payload = JSON.parse(sentMessage.payload);
    assert.strictEqual(payload.length, 1);
    assert.strictEqual(payload[0].id, msg.id);
});

test('SyncManager - receiveSyncBatch feeds into GossipEngine', async (t) => {
    const db = new MemoryLevel();
    let fedMessage = null;

    const mockGossipEngine = {
        seenMessages: new Set(),
        receiveMessage: (msg, fromPeerId) => {
            fedMessage = msg;
        }
    };

    const mockConnectionPool = {
        send: (peerId, msg) => {}
    };

    const syncManager = new SyncManager(db, {}, mockGossipEngine, mockConnectionPool);

    const missingMsg = MessageFactory.createChat('peerA', 'recovery', 'global');
    const syncBatch = MessageFactory.createSyncBatch('peerC', [missingMsg]);
    
    syncManager.receiveSyncBatch(syncBatch, 'peerC');

    assert.notStrictEqual(fedMessage, null);
    assert.strictEqual(fedMessage.id, missingMsg.id);
});

test('SyncManager - onPeerReconnected synchronizes messages across custom topics', async (t) => {
    const db = new MemoryLevel();
    const store = new MessageStore(db);

    const sentMessages = [];
    const mockConnectionPool = {
        send: (peerId, msg) => {
            if (msg.type === 'SYNC_BATCH') {
                sentMessages.push(...JSON.parse(msg.payload));
            }
        }
    };

    const mockGossipEngine = {
        topicRouter: {
            getTopicsForPeer: (peerId) => ['global', 'sports', 'teamA']
        }
    };

    const syncManager = new SyncManager(db, store, mockGossipEngine, mockConnectionPool, 'local-node');

    // Setup: peerC has only seen messages up to Lamport 5
    await syncManager.updateLastSeenLamport('peerC', 5);

    // Save messages on different topics
    const msgGlobal = MessageFactory.createChat('peerA', 'global-msg', 'global');
    msgGlobal.lamportTimestamp = 10;
    await store.save(msgGlobal);

    const msgSports = MessageFactory.createChat('peerA', 'sports-msg', 'sports');
    msgSports.lamportTimestamp = 8;
    await store.save(msgSports);

    const msgTeamA = MessageFactory.createChat('peerA', 'teamA-msg', 'teamA');
    msgTeamA.lamportTimestamp = 12;
    await store.save(msgTeamA);

    // This message is on a topic peerC is NOT subscribed to, so it should not be synced
    const msgNews = MessageFactory.createChat('peerA', 'news-msg', 'news');
    msgNews.lamportTimestamp = 15;
    await store.save(msgNews);

    await store.flush();

    // Action: Peer C reconnects
    await syncManager.onPeerReconnected('peerC');

    // Verification:
    // Should have synced msgGlobal, msgSports, and msgTeamA (since peerC is subscribed to global, sports, teamA)
    // Should NOT have synced msgNews
    assert.strictEqual(sentMessages.length, 3);
    
    const messageIds = sentMessages.map(m => m.id);
    assert.ok(messageIds.includes(msgGlobal.id), 'Should sync global message');
    assert.ok(messageIds.includes(msgSports.id), 'Should sync sports message');
    assert.ok(messageIds.includes(msgTeamA.id), 'Should sync teamA message');
    assert.ok(!messageIds.includes(msgNews.id), 'Should NOT sync unsubscribed topic message');

    // Verification: Causal ordering (sorted by Lamport timestamp: 8 -> 10 -> 12)
    assert.strictEqual(sentMessages[0].id, msgSports.id, 'Sports (Lamport 8) should be first');
    assert.strictEqual(sentMessages[1].id, msgGlobal.id, 'Global (Lamport 10) should be second');
    assert.strictEqual(sentMessages[2].id, msgTeamA.id, 'TeamA (Lamport 12) should be third');

    // Verification: last seen Lamport timestamp updated to max Lamport in sync (12)
    const newLastSeen = await syncManager.getLastSeenLamport('peerC');
    assert.strictEqual(newLastSeen, 12, 'Last seen Lamport should be updated to 12');
});

