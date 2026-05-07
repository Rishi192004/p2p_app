import { P2PNode } from '../node/index.js';
import fs from 'fs/promises';

const COLORS = {
    reset: "\x1b[0m",
    bright: "\x1b[1m",
    green: "\x1b[32m",
    yellow: "\x1b[33m",
    cyan: "\x1b[36m",
    magenta: "\x1b[35m",
    red: "\x1b[31m",
    blue: "\x1b[34m"
};

async function runLatencyBenchmark() {
    console.log(`${COLORS.bright}${COLORS.magenta}==================================================`);
    console.log(`      P2P GOSSIP: HIGH-PRECISION LATENCY AUDIT      `);
    console.log(`==================================================${COLORS.reset}\n`);

    const NUM_NODES = 5;
    const NUM_MESSAGES = 100;
    const nodes = [];
    
    console.log(`${COLORS.cyan}[INIT ]${COLORS.reset} Initializing ${NUM_NODES} nodes in a linear topology...`);
    
    // A <-> B <-> C <-> D <-> E
    for (let i = 0; i < NUM_NODES; i++) {
        const id = `Node-${String.fromCharCode(65 + i)}`;
        const port = 11000 + i;
        const dbPath = `./storage/bench-${id}`;
        
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

    // Connect them in a line and subscribe
    for (let i = 0; i < NUM_NODES; i++) {
        nodes[i].subscribe('bench');
    }

    for (let i = 0; i < NUM_NODES - 1; i++) {
        const nextNode = nodes[i + 1];
        await nodes[i].connectionPool.connect('localhost', nextNode.config.port, nextNode.config.peerId);
    }

    // Wait for stabilization
    await new Promise(r => setTimeout(r, 1000));
    console.log(`${COLORS.green}[READY]${COLORS.reset} Topology established: ${nodes.map(n => n.config.peerId).join(' <-> ')}`);
    console.log(`${COLORS.yellow}[BENCH]${COLORS.reset} Measuring propagation delay from ${nodes[0].config.peerId} to ${nodes[NUM_NODES - 1].config.peerId} (${NUM_NODES - 1} hops)...`);

    const latencies = [];
    let receivedCount = 0;

    // Listener on the target node (last node in the chain)
    nodes[NUM_NODES - 1].on('message', (msg) => {
        if (msg.payload.startsWith('PROBE-')) {
            const receivedAt = process.hrtime.bigint();
            const sentAt = BigInt(msg.payload.split(':')[1]);
            const diffMs = Number(receivedAt - sentAt) / 1_000_000;
            latencies.push(diffMs);
            receivedCount++;
            
            if (receivedCount % 10 === 0) {
                process.stdout.write(`${COLORS.cyan}.${COLORS.reset}`);
            }
        }
    });

    // Start injection
    for (let i = 0; i < NUM_MESSAGES; i++) {
        const sentAt = process.hrtime.bigint();
        nodes[0].publish('global', `PROBE-${i}:${sentAt}`);
        // Small stagger to avoid overwhelming the event loop during measurement
        await new Promise(r => setTimeout(r, 50));
    }

    // Wait for all messages to arrive
    const startWait = Date.now();
    while (receivedCount < NUM_MESSAGES && (Date.now() - startWait) < 10000) {
        await new Promise(r => setTimeout(r, 100));
    }

    console.log(`\n\n${COLORS.bright}${COLORS.magenta}--- PERFORMANCE RESULTS ---${COLORS.reset}`);
    
    if (latencies.length === 0) {
        console.log(`${COLORS.red}ERROR: No messages received!${COLORS.reset}`);
        process.exit(1);
    }

    latencies.sort((a, b) => a - b);
    
    const min = Math.min(...latencies).toFixed(2);
    const max = Math.max(...latencies).toFixed(2);
    const p50 = latencies[Math.floor(latencies.length * 0.5)].toFixed(2);
    const p95 = latencies[Math.floor(latencies.length * 0.95)].toFixed(2);
    const p99 = latencies[Math.floor(latencies.length * 0.99)].toFixed(2);
    const avg = (latencies.reduce((a, b) => a + b, 0) / latencies.length).toFixed(2);

    console.log(`| Metric | Value (ms) |`);
    console.log(`|--------|------------|`);
    console.log(`| Min    | ${min.padEnd(10)} |`);
    console.log(`| Avg    | ${avg.padEnd(10)} |`);
    console.log(`| p50    | ${COLORS.green}${p50.padEnd(10)}${COLORS.reset} |`);
    console.log(`| p95    | ${COLORS.yellow}${p95.padEnd(10)}${COLORS.reset} |`);
    console.log(`| p99    | ${COLORS.red}${p99.padEnd(10)}${COLORS.reset} |`);
    console.log(`| Max    | ${max.padEnd(10)} |`);

    console.log(`\n${COLORS.bright}${COLORS.cyan}Analysis:${COLORS.reset}`);
    console.log(`  - Propagation Hops: ${NUM_NODES - 1}`);
    console.log(`  - Reliability:      ${((receivedCount / NUM_MESSAGES) * 100).toFixed(1)}%`);
    
    if (parseFloat(p99) < 20) {
        console.log(`  - Performance:      ${COLORS.green}EXCELLENT (<20ms p99)${COLORS.reset}`);
    } else if (parseFloat(p99) < 100) {
        console.log(`  - Performance:      ${COLORS.yellow}NOMINAL (<100ms p99)${COLORS.reset}`);
    } else {
        console.log(`  - Performance:      ${COLORS.red}DEGRADED (>100ms p99)${COLORS.reset}`);
    }

    // Cleanup
    for (const node of nodes) {
        await node.stop().catch(() => {});
    }
    
    process.exit(0);
}

runLatencyBenchmark().catch(err => {
    console.error(`\n❌ ${COLORS.red}Benchmark Failed:${COLORS.reset}`, err);
    process.exit(1);
});
