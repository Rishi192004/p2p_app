import test from 'node:test';
import assert from 'node:assert';
import { AIClient } from '../ai/aiClient.js';
import { P2PNode } from '../node/index.js';
import { MessageStore } from '../storage/messageStore.js';
import { MemoryLevel } from 'memory-level';
import config from '../config/default.js';

// Lower PoW difficulty for AI client tests to prevent CPU starvation in concurrent test execution
config.POW_DIFFICULTY = 1;

test('AIClient - handles empty messages list', async () => {
    const client = new AIClient();
    const result = await client.summarizeMessages('sports', 'summary', []);
    assert.strictEqual(result, null);
});

test('AIClient - handles successful HTTP response', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url, options) => {
        assert.strictEqual(url, 'http://localhost:8001/summarize');
        assert.strictEqual(options.method, 'POST');
        const body = JSON.parse(options.body);
        assert.strictEqual(body.topic, 'sports');
        assert.strictEqual(body.mode, 'summary');
        assert.strictEqual(body.messages.length, 1);
        assert.strictEqual(body.messages[0].payload, 'hello');

        return {
            ok: true,
            json: async () => ({ topic: 'sports', mode: 'summary', summary: 'This is a mock summary' })
        };
    };

    try {
        const client = new AIClient();
        const messages = [{ id: '1', sender: 'node-A', topic: 'sports', payload: 'hello', createdAt: new Date().toISOString() }];
        const result = await client.summarizeMessages('sports', 'summary', messages);
        assert.strictEqual(result, 'This is a mock summary');
    } finally {
        globalThis.fetch = originalFetch;
    }
});

test('AIClient - handles connection errors gracefully (returns null)', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => {
        throw new Error('Connection refused');
    };

    try {
        const client = new AIClient();
        const messages = [{ id: '1', sender: 'node-A', topic: 'sports', payload: 'hello', createdAt: new Date().toISOString() }];
        const result = await client.summarizeMessages('sports', 'summary', messages);
        assert.strictEqual(result, null);
    } finally {
        globalThis.fetch = originalFetch;
    }
});

test('P2PNode - command parsing triggers manual summary broadcast', async () => {
    const originalFetch = globalThis.fetch;
    let fetchCalled = false;
    globalThis.fetch = async (url, options) => {
        fetchCalled = true;
        return {
            ok: true,
            json: async () => ({ topic: 'global', mode: 'summary', summary: 'AI summary response' })
        };
    };

    const node = new P2PNode({
        peerId: 'test-node-ai',
        port: 29999,
        dbPath: './storage/db-test-node-ai',
        aiServiceUrl: 'http://localhost:8001',
        enableDiscovery: false,
        enableMetrics: false
    });

    // Override LevelDB with in-memory DB for unit test
    node.db = new MemoryLevel();
    node.messageStore = new MessageStore(node.db);

    try {
        await node.start();

        // Feed some chat messages into the store first so there is history
        await node.messageStore.save({
            id: 'chat-1',
            type: 'CHAT',
            topic: 'global',
            sender: 'node-A',
            payload: 'First message',
            createdAt: new Date().toISOString(),
            lamportTimestamp: 1
        });
        await node.messageStore.save({
            id: 'chat-2',
            type: 'CHAT',
            topic: 'global',
            sender: 'node-B',
            payload: 'Second message',
            createdAt: new Date().toISOString(),
            lamportTimestamp: 2
        });

        // Setup a listener for the generated summary message
        const summaryReceivedPromise = new Promise((resolve) => {
            node.gossipEngine.on('message:new', (msg) => {
                if (msg.type === 'SUMMARY') {
                    resolve(msg);
                }
            });
        });

        // Trigger slash command via publish
        node.publish('global', '/summary');

        const summaryMsg = await summaryReceivedPromise;
        assert.strictEqual(summaryMsg.type, 'SUMMARY');
        assert.strictEqual(summaryMsg.topic, 'global');
        const parsedPayload = JSON.parse(summaryMsg.payload);
        assert.strictEqual(parsedPayload.summary, 'AI summary response');
        assert.strictEqual(parsedPayload.metadata.mode, 'summary');
        assert.strictEqual(parsedPayload.metadata.messageCount, 2);
        assert.strictEqual(fetchCalled, true);
    } finally {
        await node.stop();
        globalThis.fetch = originalFetch;
    }
});

test('P2PNode - auto summarization triggers after 20 messages when enabled', async () => {
    const originalFetch = globalThis.fetch;
    let fetchCalled = false;
    globalThis.fetch = async (url, options) => {
        fetchCalled = true;
        return {
            ok: true,
            json: async () => ({ topic: 'global', mode: 'summary', summary: 'Auto AI summary response' })
        };
    };

    const node = new P2PNode({
        peerId: 'test-node-ai-auto',
        port: 29998,
        dbPath: './storage/db-test-node-ai-auto',
        aiServiceUrl: 'http://localhost:8001',
        enableAutoSummary: true,
        enableDiscovery: false,
        enableMetrics: false
    });

    node.db = new MemoryLevel();
    node.messageStore = new MessageStore(node.db);

    try {
        await node.start();

        const summaryReceivedPromise = new Promise((resolve) => {
            node.gossipEngine.on('message:new', (msg) => {
                if (msg.type === 'SUMMARY') {
                    resolve(msg);
                }
            });
        });

        // Publish 20 messages to trigger auto summarization
        for (let i = 0; i < 20; i++) {
            node.publish('global', `chat message ${i}`);
        }

        const summaryMsg = await summaryReceivedPromise;
        assert.strictEqual(summaryMsg.type, 'SUMMARY');
        assert.strictEqual(summaryMsg.topic, 'global');
        const parsedPayload = JSON.parse(summaryMsg.payload);
        assert.strictEqual(parsedPayload.summary, 'Auto AI summary response');
        assert.strictEqual(parsedPayload.metadata.mode, 'summary');
        assert.strictEqual(parsedPayload.metadata.messageCount, 20);
        assert.strictEqual(fetchCalled, true);
    } finally {
        await node.stop();
        globalThis.fetch = originalFetch;
    }
});

// Debug script to find hanging handles
setTimeout(() => {
    console.log('=== DEBUG: ACTIVE HANDLES ===');
    console.log(process._getActiveHandles().map(h => ({
        type: h.constructor.name,
        details: h.fd || h.localPort || h._idleTimeout || 'no details'
    })));
    console.log('=== DEBUG: ACTIVE REQUESTS ===');
    console.log(process._getActiveRequests());
}, 2000).unref();
