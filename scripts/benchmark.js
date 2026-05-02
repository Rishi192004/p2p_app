import { fork } from 'child_process';
import fs from 'fs/promises';

/**
 * Performance Benchmark Script
 * 
 * Measures throughput, latency percentiles, and wire amplification.
 */

const N = parseInt(process.env.NODES) || 10;
const M = parseInt(process.env.MESSAGES) || 1000;
const RATE = parseInt(process.env.RATE) || 100; // msgs per second

const nodes = [];
const startTimes = new Map(); // msgId -> startTime
const latencies = [];
const receivedCounts = new Map(); // peerId -> count

async function runBenchmark() {
    console.log(`\n--- P2P BENCHMARK: ${N} Nodes, ${M} Messages ---`);
    
    // 1. Spawn Nodes
    for (let i = 0; i < N; i++) {
        const port = 4000 + i;
        const peerId = `bench-node-${i}`;
        const dbPath = `./storage/bench-db-${peerId}`;
        await fs.rm(dbPath, { recursive: true, force: true });

        // Connect each node to the previous one to form a line
        const bootstrap = i > 0 ? [`ws://localhost:${4000 + i - 1}`] : [];
        
        const child = fork('./scripts/nodeWrapper.js', [], {
            env: {
                ...process.env,
                PEER_ID: peerId,
                PORT: port.toString(),
                METRICS_PORT: (port + 1000).toString(),
                DB_PATH: dbPath,
                BOOTSTRAP_NODES: JSON.stringify(bootstrap),
                LOG_LEVEL: 'error',
                RATE_LIMIT_CAPACITY: '2000',
                RATE_LIMIT_REFILL_RATE: '1000'
            }
        });

        child.on('message', (msg) => {
            if (msg.event === 'message_received') {
                const now = Date.now();
                if (startTimes.has(msg.messageId)) {
                    latencies.push(now - startTimes.get(msg.messageId));
                }
                receivedCounts.set(peerId, (receivedCounts.get(peerId) || 0) + 1);
            }
        });

        nodes.push({ child, peerId });
    }

    console.log('Waiting for mesh stabilization...');
    await new Promise(resolve => setTimeout(resolve, 5000));

    // 2. Blast Messages
    console.log(`Sending ${M} messages at ${RATE} msgs/sec...`);
    const interval = 1000 / RATE;
    const startTime = Date.now();

    for (let i = 0; i < M; i++) {
        const msgId = `bench-msg-${i}`;
        startTimes.set(msgId, Date.now());
        nodes[0].child.send({ command: 'publish', topic: 'global', content: `Bench ${i}` });
        await new Promise(resolve => setTimeout(resolve, interval));
    }

    console.log('Messages sent. Waiting for propagation to settle...');
    await new Promise(resolve => setTimeout(resolve, 10000));

    const totalTime = (Date.now() - startTime) / 1000;

    // 3. Calculate Results
    latencies.sort((a, b) => a - b);
    const p50 = latencies[Math.floor(latencies.length * 0.5)] || 0;
    const p95 = latencies[Math.floor(latencies.length * 0.95)] || 0;
    const p99 = latencies[Math.floor(latencies.length * 0.99)] || 0;

    const totalReceived = Array.from(receivedCounts.values()).reduce((a, b) => a + b, 0);
    const throughput = M / totalTime;
    
    // Wire amplification: total transmissions across all hops / unique messages sent
    // Note: This is an approximation based on total receptions.
    const amplification = totalReceived / M;

    const results = `
# Benchmark Results: ${new Date().toISOString()}

| Metric | Value |
| :--- | :--- |
| Nodes | ${N} |
| Total Messages | ${M} |
| Targeted Throughput | ${RATE} msg/s |
| Actual Throughput | ${throughput.toFixed(2)} msg/s |
| p50 Latency | ${p50} ms |
| p95 Latency | ${p95} ms |
| p99 Latency | ${p99} ms |
| Wire Amplification | ${amplification.toFixed(2)}x |

---
*Note: Latency is measured from origination at node-0 to reception at ANY peer.*
`;

    await fs.writeFile('benchmark-results.md', results);
    console.log('\n--- BENCHMARK COMPLETE ---');
    console.log(results);

    nodes.forEach(n => n.child.kill());
    process.exit(0);
}

runBenchmark().catch(err => {
    console.error(err);
    nodes.forEach(n => n.child.kill());
    process.exit(1);
});
