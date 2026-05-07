import { WebSocketServer } from 'ws';
import { EventEmitter } from 'events';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('wsServer');

export class WSServer extends EventEmitter {
    constructor(port, localPeerId, localPublicKey = null) {
        super();
        this.port = port;
        this.localPeerId = localPeerId;
        this.localPublicKey = localPublicKey;
        this.wss = null;
        this.activeConnections = new Map(); // Map<peerId, WebSocket>
    }

    start() {
        this.wss = new WebSocketServer({ port: this.port });

        this.wss.on('listening', () => {
            logger.info({ event: 'server_started', port: this.port }, `WebSocket server listening on port ${this.port}`);
        });

        this.wss.on('connection', (ws, req) => {
            req.socket.setNoDelay(true); // Disable Nagle's Algorithm
            const ip = req.socket.remoteAddress;
            logger.info({ event: 'connection_attempt', ip }, 'New incoming connection attempt');

            let isHandshaked = false;
            let connectedPeerId = null;

            ws.on('message', (data) => {
                let parsedMsg;
                try {
                    parsedMsg = JSON.parse(data);
                } catch (err) {
                    logger.warn({ event: 'malformed_message', error: err.message }, 'Received malformed JSON message, dropping');
                    return;
                }

                if (!isHandshaked) {
                    // Expect first message to be a HELLO handshake
                    if (parsedMsg.type === 'HELLO' && parsedMsg.peerId) {
                        connectedPeerId = parsedMsg.peerId;
                        isHandshaked = true;
                        
                        // Register connection
                        this.activeConnections.set(connectedPeerId, ws);
                        logger.info({ event: 'handshake_success', peerId: connectedPeerId }, 'Peer handshake successful');
                        
                        // Send HELLO response so the client knows our identity and public key
                        const helloResponse = {
                            type: 'HELLO',
                            peerId: this.localPeerId,
                            port: this.port,
                            publicKey: this.localPublicKey
                        };
                        ws.send(JSON.stringify(helloResponse));
                        
                        this.emit('peer:connected', connectedPeerId, parsedMsg.publicKey);

                        // Create the inbound client relay
                        const inboundClient = new EventEmitter();
                        inboundClient.remotePeerId = connectedPeerId;
                        inboundClient.send = (msg) => ws.send(JSON.stringify(msg));
                        inboundClient.close = () => ws.close();
                        
                        // Local relay for this specific connection
                        const relay = (msg) => inboundClient.emit('message', msg);
                        ws._relayInboundMessage = relay;
                        
                        ws.on('close', () => inboundClient.emit('close'));
                        ws.on('error', (err) => inboundClient.emit('error', err));

                        this.emit('connection', inboundClient);
                    } else {
                        logger.warn({ event: 'handshake_failed', ip }, 'First message was not a valid HELLO handshake. Closing connection.');
                        ws.close(1008, 'Handshake required');
                    }
                    return;
                }

                // Normal message processing
                if (ws._relayInboundMessage) {
                    ws._relayInboundMessage(parsedMsg);
                }
                this.emit('message:received', parsedMsg, connectedPeerId);
            });

            ws.on('close', () => {
                if (connectedPeerId) {
                    this.activeConnections.delete(connectedPeerId);
                    logger.info({ event: 'connection_closed', peerId: connectedPeerId }, 'Peer disconnected');
                    this.emit('peer:disconnected', connectedPeerId);
                }
            });

            ws.on('error', (err) => {
                logger.error({ event: 'connection_error', peerId: connectedPeerId, error: err.message }, 'WebSocket connection error');
            });
        });
    }

    stop() {
        if (this.wss) {
            this.wss.close();
            this.activeConnections.clear();
            logger.info({ event: 'server_stopped' }, 'WebSocket server stopped');
        }
    }
}

// === SYSTEM DESIGN NOTES ===
// Tradeoff: We process the HELLO handshake directly on the WebSocket connection layer rather than passing 
// raw sockets up to the protocol layer. This violates strict OSI layering slightly but massively simplifies 
// security and resource management by preventing anonymous connections from consuming memory in the core protocol.
// What could go wrong at scale: Handshake timeouts aren't strictly enforced here. A malicious actor could 
// open thousands of TCP connections and never send a HELLO, causing a slowloris-style memory exhaustion DoS.
// How to improve in production: Implement an immediate setTimeout() upon connection that terminates the socket
// if a valid HELLO is not received within ~3 seconds. Additionally, rate-limit incoming IP connections at the 
// OS/iptables level or using an API gateway.
