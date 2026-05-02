import { fork } from 'child_process';
import path from 'path';
import fs from 'fs/promises';

/**
 * E2E Demo Script
 * 
 * Spawns 5 nodes in a specific topology and verifies gossip propagation 
 * and fault tolerance.
 * 
 * Topology:
 * [3001] <---> [3002] <---> [3003] <---> [3005]
 *                |
 *              [3004]
 */

const nodes = [];
const ports = [3001, 3002, 3003, 3004, 3005];
const receivedMessages = new Map(); // peerId -> Set of message IDs

async function spawnNode(port, bootstrapPorts = []) {
    const peerId = `node-${port}`;
    const dbPath = `./storage/demo-db-${peerId}`;
    
    // Ensure clean state
    await fs.rm(dbPath, { recursive: true, force: true });

    const bootstrapNodes = bootstrapPorts.map(p => `ws://localhost:${p}`);
    
    const child = fork('./scripts/nodeWrapper.js', [], {
        env: {
            ...process.env,
            PEER_ID: peerId,
            PORT: port.toString(),
            METRICS_PORT: (port + 1000).toString(),
            DB_PATH: dbPath,
            BOOTSTRAP_NODES: JSON.stringify(bootstrapNodes),
            LOG_LEVEL: 'info' // Show connection info
        },
        stdio: 'inherit'
    });

    return new Promise((resolve) => {
        child.on('message', (msg) => {
            if (msg.event === 'started') {
                nodes.push({ port, peerId, child });
                resolve();
            } else if (msg.event === 'message_received') {
                if (!receivedMessages.has(peerId)) {
                    receivedMessages.set(peerId, new Set());
                }
                receivedMessages.get(peerId).add(msg.messageId);
            }
        });
    });
}

async function runDemo() {
    console.log('\n--- P2P GOSSIP SYSTEM E2E DEMO ---');
    
    // 1. Spawn Nodes in Topology
    console.log('Spawning nodes...');
    await spawnNode(3001, []);
    await spawnNode(3002, [3001]);
    await spawnNode(3003, [3002]);
    await spawnNode(3004, [3002]);
    await spawnNode(3005, [3003]);

    console.log('Nodes connected. Waiting for mesh to stabilize...');
    await new Promise(resolve => setTimeout(resolve, 5000));

    // 2. Send Test Messages
    const TOTAL_MESSAGES = 20;
    console.log(`Sending ${TOTAL_MESSAGES} messages from node-3001...`);
    
    for (let i = 1; i <= TOTAL_MESSAGES; i++) {
        nodes[0].child.send({ command: 'publish', topic: 'global', content: `Test message ${i}` });
        await new Promise(resolve => setTimeout(resolve, 100)); // Small gap
    }

    console.log('Waiting for propagation...');
    await new Promise(resolve => setTimeout(resolve, 7000));

    // 3. Verify
    console.log('\n--- PROPAGATION RESULTS ---');
    let allPassed = true;
    nodes.forEach(node => {
        const count = receivedMessages.get(node.peerId)?.size || 0;
        const color = count === TOTAL_MESSAGES ? '\x1b[32m' : '\x1b[31m';
        console.log(`${node.peerId}: ${color}${count}/${TOTAL_MESSAGES} received\x1b[0m`);
        if (count < TOTAL_MESSAGES) allPassed = false;
    });

    // 4. Fault Tolerance Test
    console.log('\n--- FAULT TOLERANCE TEST ---');
    console.log('Killing node-3003 (middle of the chain)...');
    const node3003 = nodes.find(n => n.port === 3003);
    node3003.child.kill();
    
    // We need to provide an alternate path for node-3005 to reach 3001
    // Let's connect 3005 to 3004 so it can still get messages
    console.log('Connecting node-3005 to node-3004 (alternate path)...');
    const node3005 = nodes.find(n => n.port === 3005);
    node3005.child.send({ command: 'addPeer', peerId: 'node-3004', host: 'localhost', port: 3004 });
    
    await new Promise(resolve => setTimeout(resolve, 2000));

    console.log('Sending 10 more messages...');
    for (let i = 1; i <= 10; i++) {
        nodes[0].child.send({ command: 'publish', topic: 'global', content: `Post-failure message ${i}` });
        await new Promise(resolve => setTimeout(resolve, 100));
    }

    await new Promise(resolve => setTimeout(resolve, 5000));

    const count3005 = receivedMessages.get('node-3005')?.size || 0;
    console.log(`node-3005 status: ${count3005 === 30 ? '\x1b[32mPASS' : '\x1b[31mFAIL'}\x1b[0m (Total messages: ${count3005}/30)`);

    console.log('\nCleaning up...');
    nodes.forEach(n => n.child.kill());
    process.exit(allPassed ? 0 : 1);
}

runDemo().catch(err => {
    console.error(err);
    nodes.forEach(n => n.child.kill());
    process.exit(1);
});
