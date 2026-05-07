import { test } from 'node:test';
import assert from 'node:assert';
import { P2PNode } from '../node/index.js';
import fs from 'fs/promises';

/**
 * 🚀 INTERVIEW VERIFICATION TEST: P2P LATENCY AUDIT
 * 
 * Objective: Prove the system achieves low-latency gossip propagation.
 * Benchmarks: Avg < 5ms, p99 < 15ms (Optimized for single-machine simulation).
 */
test('Performance Audit: 3-Node Gossip Propagation', async (t) => {
    const NUM_NODES = 3;
    const NUM_MESSAGES = 50;
    const nodes = [];
    const latencies = [];

    // 1. Setup Phase
    await t.test('Network Setup: Mesh Topology', async () => {
        for (let i = 0; i < NUM_NODES; i++) {
            const id = `AuditNode-${String.fromCharCode(65 + i)}`;
            const port = 15000 + i;
            const dbPath = `./storage/test-audit-${id}`;
            
            await fs.rm(dbPath, { recursive: true, force: true }).catch(() => {});
            
            const node = new P2PNode({
                peerId: id,
                port: port,
                dbPath,
                rateLimitCapacity: 1000,
                rateLimitRefillRate: 100
            });
            await node.start();
            nodes.push(node);
        }

        // Build A <-> B <-> C
        await nodes[0].connectionPool.connect('localhost', nodes[1].config.port, nodes[1].config.peerId);
        await nodes[1].connectionPool.connect('localhost', nodes[2].config.port, nodes[2].config.peerId);
        
        await new Promise(r => setTimeout(r, 1000));
    });

    // 2. Execution Phase
    await t.test('Audit: Measuring p99 Latency (2 Hops)', async () => {
        let received = 0;

        // Target node (Node C) listens for probes
        nodes[NUM_NODES - 1].on('message', (msg) => {
            if (msg.payload.startsWith('AUDIT:')) {
                const receivedAt = process.hrtime.bigint();
                const sentAt = BigInt(msg.payload.split(':')[1]);
                const diffMs = Number(receivedAt - sentAt) / 1_000_000;
                latencies.push(diffMs);
                received++;
            }
        });

        // Inject messages at Node A
        for (let i = 0; i < NUM_MESSAGES; i++) {
            const sentAt = process.hrtime.bigint();
            nodes[0].publish('global', `AUDIT:${sentAt}`);
            await new Promise(r => setTimeout(r, 100)); // Optimal frequency for stable results
        }

        const start = Date.now();
        while (received < NUM_MESSAGES && (Date.now() - start) < 10000) {
            await new Promise(r => setTimeout(r, 100));
        }

        assert.strictEqual(received, NUM_MESSAGES, `Should receive all audit messages (received ${received}/${NUM_MESSAGES})`);
    });

    // 3. Analysis & Reporting
    latencies.sort((a, b) => a - b);
    const p99 = latencies[Math.floor(latencies.length * 0.99)];
    const avg = latencies.reduce((a, b) => a + b, 0) / latencies.length;

    console.log('\n--------------------------------------------------');
    console.log('       INTERVIEW AUDIT: LATENCY PERFORMANCE       ');
    console.log('--------------------------------------------------');
    console.log(`| Nodes / Hops | ${NUM_NODES} Nodes / ${NUM_NODES - 1} Hops     |`);
    console.log(`| Avg Latency  | ${avg.toFixed(2)} ms               |`);
    console.log(`| p99 Latency  | ${p99.toFixed(2)} ms               |`);
    console.log('--------------------------------------------------');

    // ASSERTIONS: Verify high-performance targets
    assert.ok(avg < 5, `Average latency (${avg.toFixed(2)}ms) should be under 5ms`);
    assert.ok(p99 < 15, `p99 latency (${p99.toFixed(2)}ms) should be under 15ms`);

    // Cleanup
    for (const node of nodes) {
        await node.stop().catch(() => {});
    }
});
