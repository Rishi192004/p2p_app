import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { WSServer, ConnectionPool } from '../../transport/index.js';
import { MessageFactory } from '../../protocol/messageFactory.js';

describe('End-to-End P2P Chat', () => {
    let nodeAServer, nodeBServer;
    let nodeAPool, nodeBPool;

    const PORT_A = 8081;
    const PORT_B = 8082;
    const ID_A = 'node-A';
    const ID_B = 'node-B';

    before(async () => {
        // Setup Node A
        nodeAServer = new WSServer(PORT_A, ID_A);
        nodeAPool = new ConnectionPool(ID_A);
        nodeAServer.start();

        // Setup Node B
        nodeBServer = new WSServer(PORT_B, ID_B);
        nodeBPool = new ConnectionPool(ID_B);
        nodeBServer.start();

        // Wait for servers to be ready
        await new Promise(resolve => setTimeout(resolve, 200));
    });

    after(() => {
        nodeAServer.stop();
        nodeBServer.stop();
        nodeAPool.disconnect(ID_B);
        nodeBPool.disconnect(ID_A);
    });

    test('Full message flow between two nodes', async () => {
        // 1. Node A connects to Node B
        const connectionPromise = new Promise(resolve => {
            nodeBServer.once('peer:connected', (peerId) => {
                assert.strictEqual(peerId, ID_A);
                resolve();
            });
        });

        nodeAPool.connect('localhost', PORT_B, ID_B);
        await connectionPromise;

        // 2. Node A sends a chat message to Node B
        const chatMsg = MessageFactory.createChat(ID_A, 'Hello from Node A!');
        
        const messageReceivedPromise = new Promise(resolve => {
            nodeBServer.once('message:received', (msg, senderId) => {
                assert.strictEqual(senderId, ID_A);
                assert.strictEqual(msg.type, 'CHAT');
                assert.strictEqual(msg.payload, 'Hello from Node A!');
                assert.ok(msg.id, 'Message should have a UUID');
                resolve();
            });
        });

        nodeAPool.broadcast(chatMsg);
        await messageReceivedPromise;
    });

    test('Bidirectional communication', async () => {
        // 1. Node B connects back to Node A
        const connectionPromise = new Promise(resolve => {
            nodeAServer.once('peer:connected', (peerId) => {
                assert.strictEqual(peerId, ID_B);
                resolve();
            });
        });

        nodeBPool.connect('localhost', PORT_A, ID_A);
        await connectionPromise;

        // 2. Node B sends an ACK message to Node A
        const ackMsg = MessageFactory.createAck(ID_B, 'original-msg-id');

        const ackReceivedPromise = new Promise(resolve => {
            nodeAServer.once('message:received', (msg, senderId) => {
                assert.strictEqual(senderId, ID_B);
                assert.strictEqual(msg.type, 'ACK');
                const payload = JSON.parse(msg.payload);
                assert.strictEqual(payload.ackId, 'original-msg-id');
                resolve();
            });
        });

        nodeBPool.broadcast(ackMsg);
        await ackReceivedPromise;
    });
});
