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
        sendToPeer: (peerId, msg) => {
            sentToPeer = peerId;
            sentMessage = msg;
        }
    };
    const mockGossipEngine = {};

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

    const syncManager = new SyncManager(db, {}, mockGossipEngine, {});

    const missingMsg = MessageFactory.createChat('peerA', 'recovery', 'global');
    
    syncManager.receiveSyncBatch([missingMsg], 'peerC');

    assert.notStrictEqual(fedMessage, null);
    assert.strictEqual(fedMessage.id, missingMsg.id);
});
