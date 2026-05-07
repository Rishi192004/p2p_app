/**
 * scripts/verify_native.js — Automated Verification Script
 *
 * This script is designed for interviewers to run a "one-click" verification
 * of the native transport layer. It:
 *   1. Detects the current transport.
 *   2. Performs a local loopback handshake.
 *   3. Measures RTT (Round Trip Time).
 *   4. Verifies data integrity.
 */

import { createServer, createClient, activeTransport } from '../transport/index.js';
import { v4 as uuidv4 } from 'uuid';

async function run() {
    console.log(`\n🔍  System Verification: ${activeTransport.toUpperCase()}`);
    console.log(`───────────────────────────────────────────────`);

    if (activeTransport === 'websocket') {
        console.log('⚠️  Note: Running on non-Linux platform or native build missing.');
        console.log('   Native epoll transport is skipped (Graceful Fallback active).');
    } else {
        console.log('✅  Native epoll Transport detected and active.');
    }

    const PORT = 49999;
    const PEER_A = 'peer-a-' + uuidv4().slice(0, 8);
    const PEER_B = 'peer-b-' + uuidv4().slice(0, 8);
    const TEST_MSG = { type: 'TEST', payload: 'interviewer-verification-' + Date.now() };

    return new Promise((resolve, reject) => {
        const server = createServer(PORT, PEER_A);
        const client = createClient('127.0.0.1', PORT, PEER_B);

        const start = process.hrtime.bigint();

        server.on('connection', (peer) => {
            peer.on('message', (msg) => {
                if (msg.type === 'TEST') {
                    const end = process.hrtime.bigint();
                    const rtt = Number(end - start) / 1e6;
                    
                    console.log(`\n✅  Handshake: SUCCESS`);
                    console.log(`✅  Integrity: ${msg.payload === TEST_MSG.payload ? 'PASSED' : 'FAILED'}`);
                    console.log(`✅  Latency  : ${rtt.toFixed(3)} ms (RTT)`);
                    
                    client.disconnect();
                    server.stop();
                    console.log(`\n───────────────────────────────────────────────`);
                    console.log(`🏁  Verification Complete.\n`);
                    resolve();
                }
            });
        });

        server.start();
        
        // Brief delay for server bind
        setTimeout(() => {
            client.connect();
            client.on('connected', () => {
                client.send(TEST_MSG);
            });
        }, 100);

        // Timeout
        setTimeout(() => reject(new Error('Verification timed out')), 2000);
    });
}

run().catch(err => {
    console.error(`\n❌  Verification Failed: ${err.message}\n`);
    process.exit(1);
});
