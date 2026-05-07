import { SyncManager } from '../storage/syncManager.js';
import { MessageStore } from '../storage/messageStore.js';
import { Level } from 'level';
import fs from 'fs/promises';
import path from 'path';
import collector from '../metrics/collector.js';

async function runTest() {
    const dbPath = './test-db-backpressure';
    await fs.mkdir(path.dirname(dbPath), { recursive: true }).catch(() => {});
    const db = new Level(dbPath);
    const messageStore = new MessageStore(db);

    // 1. Setup: Create 250 messages (3 batches of 100, 100, 50)
    for (let i = 0; i < 250; i++) {
        await messageStore.save({
            id: `msg-${i}`,
            topic: 'global',
            lamportTimestamp: i + 1,
            payload: 'test',
            sender: 'node-1'
        });
    }

    // 2. Mock GossipEngine & ConnectionPool
    const mockGossipEngine = { seenMessages: new Set() };
    const mockConnectionPool = {
        sendToPeer: (peerId, message) => {
            if (message.type === 'SYNC_BATCH') {
                // Simulate a slow receiver: wait 100ms then send ACK
                setTimeout(() => {
                    syncManager.receiveSyncAck({ payload: JSON.stringify({ batchId: message.id }) }, peerId);
                }, 100);
            }
        }
    };

    const syncManager = new SyncManager(db, messageStore, mockGossipEngine, mockConnectionPool, 'node-1');

    console.log('--- Starting Backpressure Test ---');
    console.log('Target: Sync 250 messages in 3 batches.');
    console.log('Simulated Receiver Latency: 100ms per batch.');

    const start = Date.now();
    await syncManager.onPeerReconnected('node-2');
    const end = Date.now();

    const duration = end - start;
    const metrics = collector.getSnapshot();

    console.log('\n--- Test Results ---');
    console.log(`Total Sync Duration: ${duration}ms`);
    console.log(`Batches Sent: ${metrics.counters.sync_batches_sent_total}`);
    console.log(`ACKs Received: ${metrics.counters.sync_acks_received_total}`);
    
    // Check if backpressure worked: 3 batches * 100ms = 300ms minimum
    if (duration >= 300) {
        console.log('\n✅ SUCCESS: Flow control enforced. Sender waited for receiver ACKs.');
    } else {
        console.log('\n❌ FAILURE: Flow control failed. Sender moved too fast.');
    }

    await db.close();
    await fs.rm(dbPath, { recursive: true, force: true });
}

runTest().catch(console.error);
