import { P2PNode } from './index.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('server');

const peerId = process.env.PEER_ID || `node-${Math.floor(Math.random() * 1000)}`;
const port = parseInt(process.env.PORT) || 8080;
const bootstrapNodes = process.env.BOOTSTRAP ? process.env.BOOTSTRAP.split(',') : [];

const node = new P2PNode({
    peerId,
    port,
    bootstrapNodes
});

async function main() {
    try {
        await node.start();
        logger.info({ event: 'server_up', peerId, port }, 'P2P Server is running');
    } catch (err) {
        logger.error({ event: 'server_fatal', error: err.message });
        process.exit(1);
    }
}

process.on('SIGINT', async () => {
    await node.stop();
    process.exit(0);
});

main();
