import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { P2PNode } from '../../node/index.js';
import fs from 'fs/promises';

describe('Multi-Hop Topic Routing E2E', () => {
    let nodes = [];
    const PORT_A = 16000;
    const PORT_B = 16001;
    const PORT_C = 16002;

    const ID_A = 'node-A';
    const ID_B = 'node-B';
    const ID_C = 'node-C';

    before(async () => {
        // Clean database paths
        for (const id of [ID_A, ID_B, ID_C]) {
            await fs.rm(`./storage/test-routing-${id}`, { recursive: true, force: true }).catch(() => {});
        }

        // Initialize 3 nodes: A, B, C
        const configA = { peerId: ID_A, port: PORT_A, dbPath: `./storage/test-routing-${ID_A}` };
        const configB = { peerId: ID_B, port: PORT_B, dbPath: `./storage/test-routing-${ID_B}` };
        const configC = { peerId: ID_C, port: PORT_C, dbPath: `./storage/test-routing-${ID_C}` };

        nodes.push(new P2PNode(configA));
        nodes.push(new P2PNode(configB));
        nodes.push(new P2PNode(configC));

        for (const node of nodes) {
            await node.start();
        }

        // Connect them in a line chain: A <-> B <-> C
        // Node A connects to Node B
        await nodes[0].connectionPool.connect('localhost', PORT_B, ID_B);
        // Node B connects to Node C
        await nodes[1].connectionPool.connect('localhost', PORT_C, ID_C);

        // Wait for handshakes to complete and connections to stabilize
        await new Promise(resolve => setTimeout(resolve, 2000));
    });

    after(async () => {
        for (const node of nodes) {
            await node.stop().catch(() => {});
        }
        for (const id of [ID_A, ID_B, ID_C]) {
            await fs.rm(`./storage/test-routing-${id}`, { recursive: true, force: true }).catch(() => {});
        }
    });

    test('should propagate subscription advertisements along the chain', async () => {
        // Node C subscribes to "teamA"
        nodes[2].subscribe('teamA');

        // Wait for SUB_AD message to propagate from C -> B -> A
        await new Promise(resolve => setTimeout(resolve, 2000));

        // Verify routing table on Node B:
        // Node B should have a route for topic "teamA" originating from Node-C, with next hop Node-C
        const peersB = nodes[1].gossipEngine.topicRouter.getPeersForTopic('teamA');
        assert.ok(peersB.has(ID_C), 'Node B should route "teamA" messages to Node C');

        // Verify routing table on Node A:
        // Node A should have a route for topic "teamA" originating from Node-C, with next hop Node-B
        const peersA = nodes[0].gossipEngine.topicRouter.getPeersForTopic('teamA');
        assert.ok(peersA.has(ID_B), 'Node A should route "teamA" messages to Node B to reach C');
    });

    test('should selectively route topic messages through non-subscribed transit nodes', async () => {
        let receivedMessageC = null;
        let receivedMessageB = null;

        // Register listeners to verify delivery
        nodes[2].on('message', (msg) => {
            if (msg.topic === 'teamA') {
                receivedMessageC = msg;
            }
        });

        nodes[1].on('message', (msg) => {
            if (msg.topic === 'teamA') {
                receivedMessageB = msg;
            }
        });

        // Node A publishes a message on topic "teamA"
        const content = 'Hello team A!';
        const msgId = nodes[0].publish('teamA', content);

        // Wait for gossip propagation
        await new Promise(resolve => setTimeout(resolve, 2000));

        // Verify Node C (interested subscriber) received the message
        assert.notStrictEqual(receivedMessageC, null, 'Node C should have received the message');
        assert.strictEqual(receivedMessageC.id, msgId);
        assert.strictEqual(receivedMessageC.payload, content);

        // Verify Node B acted as transit. Node B received it but it is NOT subscribed,
        // so its localSubscriptions does not have 'teamA'.
        assert.ok(!nodes[1].localSubscriptions.has('teamA'), 'Node B should not be locally subscribed to teamA');
    });
});
