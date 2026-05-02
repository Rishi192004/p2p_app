import { P2PNode } from '../node/index.js';

const node = new P2PNode({
    peerId: process.env.PEER_ID,
    port: parseInt(process.env.PORT),
    metricsPort: parseInt(process.env.METRICS_PORT),
    dbPath: process.env.DB_PATH,
    bootstrapNodes: JSON.parse(process.env.BOOTSTRAP_NODES || '[]')
});

node.on('message', (msg) => {
    process.send({ event: 'message_received', messageId: msg.id, sender: msg.sender });
});

node.start().then(() => {
    node.subscribe('global');
    process.send({ event: 'started' });
});

process.on('message', async (cmd) => {
    if (cmd.command === 'publish') {
        node.publish(cmd.topic, cmd.content);
    } else if (cmd.command === 'addPeer') {
        node.peerManager.addPeer(cmd.peerId, cmd.host, cmd.port);
    }
});

process.on('SIGTERM', () => {
    node.stop().then(() => process.exit(0));
});
