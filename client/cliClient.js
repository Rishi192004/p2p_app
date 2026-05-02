import readline from 'readline';
import { P2PNode } from '../node/index.js';
import collector from '../metrics/collector.js';

// ANSI Colors
const COLORS = {
    reset: "\x1b[0m",
    cyan: "\x1b[36m",
    yellow: "\x1b[33m",
    white: "\x1b[37m",
    gray: "\x1b[90m",
    red: "\x1b[31m",
    green: "\x1b[32m"
};

const peerId = process.env.PEER_ID || `user-${Math.floor(Math.random() * 1000)}`;
const port = parseInt(process.env.PORT) || 8080;
const metricsPort = parseInt(process.env.METRICS_PORT) || (port + 1000);

const node = new P2PNode({
    peerId,
    port,
    metricsPort,
    dbPath: `./storage/db-${peerId}`
});

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: `${COLORS.cyan}${peerId}${COLORS.reset}> `
});

let currentTopic = 'global';

// Tracking for delivery confirmation
const pendingMessages = new Map();

function formatTime() {
    return new Date().toLocaleTimeString('en-GB', { hour12: false });
}

function logSystem(msg) {
    console.log(`\n${COLORS.gray}[${formatTime()}]${COLORS.reset} ${COLORS.yellow}SYSTEM: ${msg}${COLORS.reset}`);
    rl.prompt();
}

function logMessage(msg) {
    const isSelf = msg.sender === peerId;
    const color = isSelf ? COLORS.cyan : COLORS.white;
    const shortId = msg.sender.substring(0, 8);
    const time = formatTime();
    
    // Check if we have an ACK for this message (if it was ours)
    let ackStatus = '';
    if (isSelf) {
        // We'll update the line later when ACK arrives, but for simplicity in CLI 
        // we just print it. To make it "✓" or "✗" we'd need to manage lines.
        // For this implementation, we'll just log confirmations as system events.
    }

    process.stdout.clearLine(0);
    process.stdout.cursorTo(0);
    const prefix = isSelf ? (pendingMessages.has(msg.id) ? '' : '✓ ') : '';
    console.log(`${COLORS.gray}[${time}]${COLORS.reset} ${COLORS.gray}[${msg.topic}]${COLORS.reset} ${color}${prefix}<${shortId}>: ${msg.payload}${COLORS.reset}`);
    rl.prompt();
}

node.on('delivery:confirmed', (messageId) => {
    // In a real CLI we would rewrite the line, but for this simple version 
    // we'll just log a system event to keep the code clean and readable.
    if (pendingMessages.has(messageId)) {
        logSystem(`Message confirmed: "${pendingMessages.get(messageId).substring(0, 20)}..." ✓`);
        pendingMessages.delete(messageId);
    }
});

node.on('delivery:failed', ({ messageId }) => {
    if (pendingMessages.has(messageId)) {
        logSystem(`Message FAILED: "${pendingMessages.get(messageId).substring(0, 20)}..." ✗`);
        pendingMessages.delete(messageId);
    }
});

node.on('message', (msg) => {
    logMessage(msg);
});

// We can use the AckManager events to show confirmation
// But P2PNode doesn't expose AckManager directly yet, let's just use simple console logs
// Actually, let's expose it or just listen to delivery events on the node
// In P2PNode, I'll add an event relay for delivery status.

node.start().then(() => {
    logSystem(`Node started on port ${port}. Welcome to the Mesh.`);
    logSystem(`Type /help for commands.`);
    node.subscribe('global');
    rl.prompt();
});

rl.on('line', (line) => {
    const input = line.trim();
    if (!input) {
        rl.prompt();
        return;
    }

    if (input.startsWith('/')) {
        const [cmd, ...args] = input.substring(1).split(' ');
        
        switch (cmd) {
            case 'join':
                const topic = args[0] || 'global';
                node.subscribe(topic);
                currentTopic = topic;
                logSystem(`Joined topic: ${topic}`);
                break;
            case 'leave':
                const leaveTopic = args[0] || currentTopic;
                node.unsubscribe(leaveTopic);
                logSystem(`Left topic: ${leaveTopic}`);
                break;
            case 'peers':
                const peers = node.connectionPool.getActivePeers();
                logSystem(`Active Peers (${peers.length}):\n` + peers.join('\n'));
                break;
            case 'metrics':
                const snapshot = collector.getSnapshot();
                console.log(JSON.stringify(snapshot, null, 2));
                break;
            case 'send':
                const sendTopic = args[0];
                const sendMsg = args.slice(1).join(' ');
                if (!sendTopic || !sendMsg) {
                    logSystem('Usage: /send <topic> <message>');
                } else {
                    node.publish(sendTopic, sendMsg);
                }
                break;
            case 'dm':
                const targetPeer = args[0];
                const dmMsg = args.slice(1).join(' ');
                if (!targetPeer || !dmMsg) {
                    logSystem('Usage: /dm <peerId> <message>');
                } else {
                    node.sendDM(targetPeer, dmMsg);
                    logSystem(`DM sent to ${targetPeer}`);
                }
                break;
            case 'help':
                logSystem(`Commands:
  /join <topic>    - Subscribe to a topic
  /leave <topic>   - Unsubscribe
  /peers           - List active peers
  /metrics         - Show performance stats
  /send <t> <m>    - Send message to specific topic
  /dm <p> <m>      - Direct message to peer
  /help            - Show this help`);
                break;
            case 'exit':
            case 'quit':
                node.stop().then(() => process.exit(0));
                break;
            default:
                logSystem(`Unknown command: ${cmd}`);
        }
    } else {
        // Plain text -> current topic
        const msgId = node.publish(currentTopic, input);
        pendingMessages.set(msgId, input);
    }
    
    rl.prompt();
});

process.on('SIGINT', () => {
    node.stop().then(() => process.exit(0));
});
