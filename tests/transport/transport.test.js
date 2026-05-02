import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { WSServer, WSClient, ConnectionPool } from '../../transport/index.js';
import config from '../../config/default.js';

describe('Transport Layer', () => {
    let server;
    const SERVER_PORT = 8081; // Use a different port for testing to avoid conflicts
    const SERVER_PEER_ID = 'server-peer-1';
    
    before(async () => {
        // Start the server before running transport tests
        server = new WSServer(SERVER_PORT, SERVER_PEER_ID);
        server.start();
        
        // Give the server a moment to bind to the port
        await new Promise(resolve => setTimeout(resolve, 100));
    });

    after(() => {
        // Clean up the server after tests
        if (server) {
            server.stop();
        }
    });

    test('WSClient connects and performs HELLO handshake', async () => {
        const clientPeerId = 'client-peer-1';
        const client = new WSClient('localhost', SERVER_PORT, clientPeerId, SERVER_PEER_ID);
        
        const connectedPromise = new Promise(resolve => {
            server.once('peer:connected', (peerId) => {
                assert.strictEqual(peerId, clientPeerId, 'Server should receive correct peerId in handshake');
                resolve();
            });
        });

        client.connect();
        
        await connectedPromise;
        client.disconnect();
    });

    test('WSClient queues messages when offline and flushes on connect', async () => {
        const clientPeerId = 'client-peer-2';
        const client = new WSClient('localhost', SERVER_PORT, clientPeerId, SERVER_PEER_ID);
        
        const testMsg = { type: 'CHAT', payload: 'test payload' };
        
        // Send while offline
        client.send(testMsg);
        assert.strictEqual(client.messageQueue.length, 1, 'Message should be queued');

        const messageReceivedPromise = new Promise(resolve => {
            server.once('message:received', (msg, peerId) => {
                assert.strictEqual(peerId, clientPeerId);
                assert.strictEqual(msg.type, 'CHAT');
                assert.strictEqual(msg.payload, 'test payload');
                resolve();
            });
        });

        // Connecting should flush the queue
        client.connect();
        await messageReceivedPromise;
        
        assert.strictEqual(client.messageQueue.length, 0, 'Queue should be empty after flush');
        client.disconnect();
    });

    test('ConnectionPool enforces MAX_PEERS limit', () => {
        const originalMax = config.MAX_PEERS;
        config.MAX_PEERS = 2; // Temporarily lower limit for testing

        const pool = new ConnectionPool('pool-peer');
        
        pool.connect('localhost', SERVER_PORT, 'peerA');
        pool.connect('localhost', SERVER_PORT, 'peerB');
        
        assert.strictEqual(pool.outboundConnections.size, 2);

        // Attempt to connect a third peer
        pool.connect('localhost', SERVER_PORT, 'peerC');
        assert.strictEqual(pool.outboundConnections.size, 2, 'Should not exceed MAX_PEERS limit');

        // Clean up
        pool.disconnect('peerA');
        pool.disconnect('peerB');
        config.MAX_PEERS = originalMax; // Restore config
    });
});
