/**
 * nativeTransport.js — JavaScript bridge over the C++ epoll transport
 *
 * Wraps the native NativeTCPServer / NativeTCPClient addon in an interface
 * identical to WSServer / WSClient so the rest of the codebase is unaware of
 * which transport is active.
 *
 * Event API (matches WSServer):
 *   server.emit('connection', clientEmitter)   → new inbound peer
 *   server.emit('peer:connected', peerId, key) → handshake complete
 *   server.emit('peer:disconnected', peerId)   → peer gone
 *   server.emit('message:received', msg, id)   → data message
 */

import { EventEmitter } from 'events';
import { createRequire } from 'module';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('nativeTransport');

// ── Load the native addon (built by node-gyp on Linux) ─────────────────────

let NativeTCPServer = null;
let NativeTCPClient = null;

try {
    // createRequire is needed because the project uses "type":"module" (ESM).
    // The .node addon is a CJS-style file so we need a CJS require() call.
    const _require = createRequire(import.meta.url);
    const addon = _require('../build/Release/native_transport.node');

    if (!addon.__platform_unsupported__) {
        NativeTCPServer = addon.NativeTCPServer;
        NativeTCPClient = addon.NativeTCPClient;
        logger.info({ event: 'addon_loaded' }, '✅  Native epoll transport addon loaded');
    }
} catch (err) {
    logger.warn(
        { event: 'addon_load_failed', error: err.message },
        'Native transport addon not available — falling back to WebSocket transport'
    );
}

export const isNativeAvailable = NativeTCPServer !== null;

// ─────────────────────────────────────────────────────────────────────────────
// NativePeerEmitter — duck-type equivalent of the inboundClient in wsServer.js
// ─────────────────────────────────────────────────────────────────────────────

class NativePeerEmitter extends EventEmitter {
    /**
     * @param {number} fd       - Socket file descriptor (peer identifier)
     * @param {object} serverRef - The NativeServer instance (to route send()s)
     */
    constructor(fd, serverRef) {
        super();
        this.fd = fd;
        this._server = serverRef;
        this.remotePeerId = null; // Set after HELLO handshake
    }

    /**
     * Send a JSON message to this peer.
     * Mirrors wsClient.send() which also JSON-serializes before writing.
     */
    send(msg) {
        const raw = JSON.stringify(msg);
        const ok = this._server._native.send(this.fd, raw);
        if (!ok) {
            logger.warn({ event: 'send_failed', fd: this.fd }, 'Native send() returned false');
        }
    }

    close() {
        // Graceful close — we can't call shutdown() on the native side directly
        // so we rely on the epoll loop detecting EPOLLHUP after we stop sending.
        logger.info({ event: 'peer_close_requested', fd: this.fd });
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// NativeServer — drop-in replacement for WSServer
// ─────────────────────────────────────────────────────────────────────────────

export class NativeServer extends EventEmitter {
    /**
     * @param {number} port
     * @param {string} localPeerId
     * @param {string|null} localPublicKey
     */
    constructor(port, localPeerId, localPublicKey = null) {
        super();
        this.port = port;
        this.localPeerId = localPeerId;
        this.localPublicKey = localPublicKey;

        /** @type {Map<number, NativePeerEmitter>} fd → peer emitter */
        this._peers = new Map();

        /** @type {NativeTCPServer|null} */
        this._native = null;
    }

    /**
     * Start the epoll event loop on port `this.port`.
     * The C++ thread calls our JS callback for every inbound event.
     */
    start() {
        if (!NativeTCPServer) {
            throw new Error('Native addon not available on this platform');
        }

        this._native = new NativeTCPServer();

        this._native.start(this.port, (event) => {
            this._onNativeEvent(event);
        });

        logger.info(
            { event: 'server_started', port: this.port },
            `Native TCP server (epoll/EPOLLET) listening on port ${this.port}`
        );
    }

    stop() {
        if (this._native) {
            this._native.stop();
            this._native = null;
            this._peers.clear();
            logger.info({ event: 'server_stopped' }, 'Native TCP server stopped');
        }
    }

    // ── Internal event dispatcher ─────────────────────────────────────────────

    _onNativeEvent(event) {
        const { fd, isConnect, isClose, payload } = event;

        if (isConnect) {
            // ── New connection ─────────────────────────────────────────────
            logger.info({ event: 'connection_attempt', fd }, 'New native TCP connection');

            const peer = new NativePeerEmitter(fd, this);
            this._peers.set(fd, peer);

            // We wait for the HELLO handshake before emitting 'connection'
            // (same behaviour as WSServer — anonymous sockets don't propagate up)

        } else if (isClose) {
            // ── Connection closed ──────────────────────────────────────────
            const peer = this._peers.get(fd);
            if (peer) {
                this._peers.delete(fd);
                peer.emit('close');
                if (peer.remotePeerId) {
                    this.emit('peer:disconnected', peer.remotePeerId);
                    logger.info({ event: 'peer_disconnected', peerId: peer.remotePeerId, fd });
                }
            }

        } else if (payload && payload.length > 0) {
            // ── Data received ──────────────────────────────────────────────
            const peer = this._peers.get(fd);
            if (!peer) return;

            let parsed;
            try {
                parsed = JSON.parse(payload);
            } catch {
                logger.warn({ event: 'malformed_json', fd }, 'Dropping malformed JSON frame');
                return;
            }

            if (!peer._handshaked) {
                // First message must be a HELLO
                if (parsed.type === 'HELLO' && parsed.peerId) {
                    peer._handshaked = true;
                    peer.remotePeerId = parsed.peerId;

                    this._peers.set(fd, peer);
                    logger.info({ event: 'handshake_success', peerId: parsed.peerId, fd });

                    // Reply with our own HELLO
                    peer.send({
                        type: 'HELLO',
                        peerId: this.localPeerId,
                        port: this.port,
                        publicKey: this.localPublicKey,
                    });

                    this.emit('peer:connected', peer.remotePeerId, parsed.publicKey);
                    this.emit('connection', peer);
                } else {
                    logger.warn({ event: 'handshake_failed', fd }, 'Invalid HELLO — closing');
                    // Drop the fd (remote will get RST)
                    this._peers.delete(fd);
                }
                return;
            }

            // Normal message
            peer.emit('message', parsed);
            this.emit('message:received', parsed, peer.remotePeerId);
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// NativeClient — drop-in replacement for WSClient
// ─────────────────────────────────────────────────────────────────────────────

export class NativeClient extends EventEmitter {
    /**
     * @param {string} host
     * @param {number} port
     * @param {string} localPeerId
     * @param {string|null} remotePeerId
     * @param {string|null} localPublicKey
     */
    constructor(host, port, localPeerId, remotePeerId = null, localPublicKey = null) {
        super();
        this.host = host;
        this.port = port;
        this.localPeerId = localPeerId;
        this.remotePeerId = remotePeerId;
        this.localPublicKey = localPublicKey;
        this.isConnected = false;
        this._native = null;
        this._messageQueue = [];
    }

    connect() {
        if (!NativeTCPClient) {
            throw new Error('Native addon not available on this platform');
        }

        this._native = new NativeTCPClient();

        this._native.connect(this.host, this.port, (event) => {
            this._onClientEvent(event);
        });
    }

    send(message) {
        if (!this.isConnected || !this._native) {
            this._messageQueue.push(message);
            return;
        }
        this._native.send(JSON.stringify(message));
    }

    disconnect() {
        if (this._native) {
            this._native.disconnect();
            this._native = null;
        }
        this.isConnected = false;
        this._messageQueue = [];
    }

    // ── Internal ──────────────────────────────────────────────────────────────

    _onClientEvent(event) {
        switch (event.kind) {
            case 'connected': {
                this.isConnected = true;
                // Send HELLO handshake (mirrors WSClient behaviour)
                this._native.send(JSON.stringify({
                    type: 'HELLO',
                    peerId: this.localPeerId,
                    port: this.port,
                    ...(this.localPublicKey && { publicKey: this.localPublicKey }),
                }));
                this.emit('connected');
                this._flushQueue();
                logger.info({ event: 'connected', host: this.host, port: this.port });
                break;
            }
            case 'data': {
                let parsed;
                try { parsed = JSON.parse(event.payload); } catch { return; }
                this.emit('message', parsed);
                break;
            }
            case 'close': {
                this.isConnected = false;
                this.emit('disconnected');
                logger.info({ event: 'disconnected', host: this.host, port: this.port });
                break;
            }
            case 'error': {
                logger.error({ event: 'client_error', error: event.payload });
                this.emit('error', new Error(event.payload));
                break;
            }
        }
    }

    _flushQueue() {
        while (this._messageQueue.length > 0 && this.isConnected && this._native) {
            const msg = this._messageQueue.shift();
            this._native.send(JSON.stringify(msg));
        }
    }
}
