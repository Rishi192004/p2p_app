import { SyncManager } from '../storage/syncManager.js';
import { MessageStore } from '../storage/messageStore.js';
import { Level } from 'level';
import fs from 'fs/promises';
import path from 'path';
import collector from '../metrics/collector.js';

async function runTest() {
    const dbPath = './test-db-backpressure';
    await fs.rm(dbPath, { recursive: true, force: true }).catch(() => {});
    await fs.mkdir(path.dirname(dbPath), { recursive: true }).catch(() => {});
    
    const db = new Level(dbPath);
    const messageStore = new MessageStore(db);

    // 1. Setup: Create 250 messages
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

    console.log(`${COLORS.cyan}[SYNC ]${COLORS.reset} Initializing sync for 250 messages (3 batches).`);
    console.log(`${COLORS.yellow}[FLOW ]${COLORS.reset} Simulating 100ms processing delay per batch...`);

    const start = Date.now();
    await syncManager.onPeerReconnected('node-2');
    const end = Date.now();

    const duration = end - start;
    const metrics = collector.getSnapshot();

    console.log(`\n📊 ${COLORS.bright}Flow Control Metrics:${COLORS.reset}`);
    console.log(`  - Total Sync Duration: ${COLORS.cyan}${duration}ms${COLORS.reset}`);
    console.log(`  - Batches Acknowledged: ${COLORS.green}${metrics.counters.sync_acks_received_total}${COLORS.reset}`);
    
    if (duration >= 300) {
        console.log(`\n✅ ${COLORS.green}Success: Backpressure enforced. Sender successfully throttled.${COLORS.reset}`);
    } else {
        console.log(`\n❌ ${COLORS.red}Failure: Flow control failed. Sender moved too fast.${COLORS.reset}`);
    }

    await db.close();
    await fs.rm(dbPath, { recursive: true, force: true }).catch(() => {});
}

const COLORS = {
    reset: "\x1b[0m",
    bright: "\x1b[1m",
    green: "\x1b[32m",
    yellow: "\x1b[33m",
    cyan: "\x1b[36m",
    magenta: "\x1b[35m",
    red: "\x1b[31m"
};

runTest().catch(console.error);
