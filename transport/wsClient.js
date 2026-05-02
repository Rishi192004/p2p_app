import WebSocket from 'ws';
import { EventEmitter } from 'events';
import { createLogger } from '../utils/logger.js';
import config from '../config/default.js';

const logger = createLogger('wsClient');

export class WSClient extends EventEmitter {
    constructor(host, port, localPeerId, remotePeerId = null, localPublicKey = null) {
        super();
        this.host = host;
        this.port = port;
        this.url = `ws://${host}:${port}`;
        this.localPeerId = localPeerId;
        this.remotePeerId = remotePeerId; // The ID of the peer we intend to connect to
        this.localPublicKey = localPublicKey;

        this.ws = null;
        this.isConnected = false;
        this.isClosedIntentionally = false;
        
        // Reconnection state
        this.reconnectAttempts = 0;
        this.reconnectDelay = config.INITIAL_RECONNECT_DELAY_MS;
        this.reconnectTimer = null;

        // Message queue for buffering sends while offline
        this.messageQueue = [];
    }

    connect() {
        if (this.ws && (this.ws.readyState === WebSocket.CONNECTING || this.ws.readyState === WebSocket.OPEN)) {
            return; // Already connecting or connected
        }

        this.isClosedIntentionally = false;
        logger.info({ event: 'connecting', url: this.url, targetPeerId: this.remotePeerId }, `Connecting to peer at ${this.url}`);
        
        this.ws = new WebSocket(this.url);

        this.ws.on('open', () => {
            logger.info({ event: 'connected', url: this.url, targetPeerId: this.remotePeerId }, 'Successfully connected to peer');
            this.isConnected = true;
            this.reconnectAttempts = 0;
            this.reconnectDelay = config.INITIAL_RECONNECT_DELAY_MS;

            // Immediately send HELLO handshake
            const helloMsg = { 
                type: 'HELLO', 
                peerId: this.localPeerId,
                port: config.PORT, // Inform them our listening port
                ...(this.localPublicKey && { publicKey: this.localPublicKey })
            };
            this.ws.send(JSON.stringify(helloMsg));

            this.emit('connected');
            this.#flushQueue();
        });

        this.ws.on('message', (data) => {
            let parsedMsg;
            try {
                parsedMsg = JSON.parse(data);
            } catch (err) {
                logger.warn({ event: 'malformed_message', url: this.url, error: err.message }, 'Received malformed JSON message');
                return;
            }
            this.emit('message', parsedMsg);
        });

        this.ws.on('close', () => {
            this.isConnected = false;
            logger.info({ event: 'disconnected', url: this.url, targetPeerId: this.remotePeerId }, 'Connection closed');
            this.emit('disconnected');
            
            this.#handleReconnect();
        });

        this.ws.on('error', (err) => {
            logger.error({ event: 'connection_error', url: this.url, error: err.message }, 'WebSocket client error');
            // 'close' event will follow automatically after 'error' in ws package, triggering reconnect there.
        });
    }

    send(message) {
        if (!this.isConnected || this.ws.readyState !== WebSocket.OPEN) {
            logger.debug({ event: 'queue_message', url: this.url, msgType: message.type }, 'Connection not open, queuing message');
            this.messageQueue.push(message);
            return;
        }

        this.ws.send(JSON.stringify(message));
    }

    disconnect() {
        this.isClosedIntentionally = true;
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
        if (this.ws) {
            this.ws.close(1000, 'Intentional disconnect');
            this.ws = null;
        }
        this.messageQueue = []; // Clear queue on intentional disconnect
        logger.info({ event: 'manual_disconnect', url: this.url }, 'Manually disconnected from peer');
    }

    #handleReconnect() {
        if (this.isClosedIntentionally) return;

        if (this.reconnectAttempts >= config.MAX_RECONNECT_ATTEMPTS) {
            logger.error({ event: 'max_retries_reached', url: this.url }, 'Max reconnection attempts reached. Giving up.');
            this.emit('failed');
            return;
        }

        this.reconnectAttempts++;
        logger.info({ event: 'reconnect_scheduled', delay: this.reconnectDelay, attempt: this.reconnectAttempts }, `Scheduling reconnect to ${this.url}`);

        this.reconnectTimer = setTimeout(() => {
            this.connect();
        }, this.reconnectDelay);

        // Exponential backoff
        this.reconnectDelay = Math.min(this.reconnectDelay * 2, config.MAX_RECONNECT_DELAY_MS);
    }

    #flushQueue() {
        if (this.messageQueue.length === 0) return;
        logger.info({ event: 'flushing_queue', count: this.messageQueue.length }, 'Flushing queued messages');
        
        while (this.messageQueue.length > 0 && this.isConnected && this.ws.readyState === WebSocket.OPEN) {
            const msg = this.messageQueue.shift();
            this.ws.send(JSON.stringify(msg));
        }
    }
}

// === SYSTEM DESIGN NOTES ===
// Tradeoff: We implemented a message queue for offline buffering. This ensures messages aren't lost 
// during brief network hiccups (like a cellular drop). However, it introduces state to the transport layer.
// What could go wrong at scale: Unbounded queue growth. If a peer goes offline for a long time but we keep 
// trying to send to them, the `messageQueue` will grow infinitely, eventually causing an Out of Memory (OOM) 
// crash in the Node.js process. Retry storms are mitigated by exponential backoff, but memory leaks remain a risk.
// How to improve in production: Implement a `MAX_QUEUE_SIZE` or queue TTL (Time To Live). If the queue exceeds 
// 1000 items, start dropping the oldest messages (ring buffer) or persist the queue to LevelDB instead of RAM.
