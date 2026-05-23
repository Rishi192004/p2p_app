import { EventEmitter } from 'events';
import { Level } from 'level';
import path from 'path';
import fs from 'fs/promises';

import { ConnectionPool } from '../transport/connectionPool.js';
import { WSServer } from '../transport/wsServer.js';
import { GossipEngine } from '../protocol/gossipEngine.js';
import { LamportClock } from '../protocol/lamportClock.js';
import { AckManager } from '../protocol/ackManager.js';
import { SecurityManager } from '../security/index.js';
import { MessageStore } from '../storage/messageStore.js';
import { SyncManager } from '../storage/syncManager.js';
import { PeerManager } from './peerManager.js';
import { Discovery } from './discovery/index.js';
import { MetricsReporter } from '../metrics/reporter.js';
import { MessageFactory } from '../protocol/messageFactory.js';
import { createLogger } from '../utils/logger.js';
import collector from '../metrics/collector.js';

const logger = createLogger('node');

/**
 * P2PNode Orchestrator
 * 
 * This class wires together all layers of the system:
 * Transport -> Security -> Protocol -> Storage -> Observability
 */
export class P2PNode extends EventEmitter {
    constructor(config = {}) {
        super();
        this.config = {
            peerId: config.peerId || `node-${Math.floor(Math.random() * 1000)}`,
            port: config.port || 8080,
            dbPath: config.dbPath || `./storage/db-${config.peerId || 'default'}`,
            bootstrapNodes: config.bootstrapNodes || [],
            metricsPort: config.metricsPort || (config.port + 10) || 8090,
            ...config
        };

        // 1. Core State & Clock
        this.lamportClock = new LamportClock();
        
        // 2. Storage
        this.db = null;
        this.messageStore = null;
        this.syncManager = null;

        // 3. Security
        this.securityManager = new SecurityManager();

        // 4. Transport
        this.connectionPool = null;
        this.wsServer = null;

        // 5. Protocol
        this.gossipEngine = null;
        this.ackManager = null;

        // 6. Lifecycle & Discovery
        this.peerManager = null;
        this.discovery = null;
        
        // 7. Observability
        this.metricsReporter = new MetricsReporter(this.config.metricsPort);

        // 8. Topic Routing State
        this.localSubscriptions = new Set([
            'global',
            `dm:${this.config.peerId}`
        ]);
        this.localSequences = new Map();
        this.gcInterval = null;
        this.refreshInterval = null;
    }

    async start() {
        logger.info({ event: 'node_starting', peerId: this.config.peerId, port: this.config.port });

        // Initialize Security (Load/Generate Keys)
        await this.securityManager.init(this.config.peerId);
        const localPublicKey = this.securityManager.keyManager.getPublicKey();

        // Initialize Storage
        await fs.mkdir(path.dirname(this.config.dbPath), { recursive: true });
        this.db = new Level(this.config.dbPath);
        this.messageStore = new MessageStore(this.db);
        
        // Initialize Transport
        const getSubs = () => Array.from(this.localSubscriptions);
        this.connectionPool = new ConnectionPool(this.config.peerId, localPublicKey, getSubs);
        this.wsServer = new WSServer(this.config.port, this.config.peerId, localPublicKey, getSubs);
        
        // Initialize Protocol
        this.gossipEngine = new GossipEngine(this.connectionPool, this.lamportClock, this.securityManager, this.config);
        this.ackManager = new AckManager(this.connectionPool, this.lamportClock);
        this.syncManager = new SyncManager(this.db, this.messageStore, this.gossipEngine, this.connectionPool, this.config.peerId);
        
        // Initialize Lifecycle
        this.peerManager = new PeerManager(this.connectionPool);
        this.discovery = new Discovery(this.peerManager, this.connectionPool, {
            localPeerId: this.config.peerId,
            port: this.config.port,
            bootstrapNodes: this.config.bootstrapNodes
        });

        // --- Wiring Events ---

        // Inbound Connections from Server -> Pool
        this.wsServer.on('connection', (client) => {
            this.connectionPool.addInboundConnection(client);
        });

        // Handle peer disconnection and failure to purge routes
        this.connectionPool.on('peer:disconnected', (peerId) => {
            this.gossipEngine.topicRouter.clearRoutesForPeer(peerId);
        });

        this.connectionPool.on('peer:failed', (peerId) => {
            this.gossipEngine.topicRouter.clearRoutesForPeer(peerId);
        });

        // Messages from Pool -> Gossip Engine / Ack Manager
        this.connectionPool.on('message:received', async (message, fromPeerId) => {
            if (message.type === 'ACK') {
                this.ackManager.receiveAck(message);
            } else if (message.type === 'SYNC_BATCH') {
                this.syncManager.receiveSyncBatch(message, fromPeerId);
            } else if (message.type === 'SYNC_ACK') {
                this.syncManager.receiveSyncAck(message, fromPeerId);
            } else if (message.type === 'HELLO') {
                // HELLO contains public key for security
                this.securityManager.registerPeerKey(message.peerId, message.publicKey);
                this.peerManager.updateHeartbeat(message.peerId);
                logger.info({ event: 'handshake_processed', from: message.peerId });

                // Register any subscriptions shared during handshake
                if (message.subscriptions && Array.isArray(message.subscriptions)) {
                    const ROUTE_LEASE_MS = 30000;
                    const expiresAt = Date.now() + ROUTE_LEASE_MS;
                    for (const topic of message.subscriptions) {
                        this.gossipEngine.topicRouter.updateRoute(
                            topic,
                            message.peerId, // originPeerId
                            message.peerId, // nextHop
                            0,              // hopCount (0 since they are directly connected to us)
                            0,              // sequenceNumber
                            [],             // path
                            expiresAt       // soft-state lease expiry
                        );
                    }
                    logger.info({ event: 'handshake_subscriptions_registered', peerId: message.peerId, count: message.subscriptions.length });
                }
            } else if (message.type === 'HEARTBEAT') {
                this.peerManager.updateHeartbeat(message.sender);
            } else if (message.type === 'PEER_EXCHANGE' || message.type === 'PEER_LIST') {
                // Handled by DiscoveryOrchestrator's PeerExchange internal listener
            } else {
                // Standard Gossip
                this.gossipEngine.receiveMessage(message, fromPeerId);
            }
        });

        // New Gossip Messages -> Storage & UI
        this.gossipEngine.on('message:new', async (message) => {
            if (message.type === 'SUB_AD') {
                return; // Do not save routing control messages to LevelDB
            }
            await this.messageStore.save(message);
            this.emit('message', message);
        });

        // Peer Reconnection -> Trigger Sync
        this.connectionPool.on('pool_peer_connected', (peerId) => {
            this.syncManager.onPeerReconnected(peerId);
        });

        // Delivery Confirmations -> relay to UI
        this.ackManager.on('delivery:confirmed', (messageId) => {
            this.emit('delivery:confirmed', messageId);
        });

        this.ackManager.on('delivery:failed', ({ messageId, failedPeers }) => {
            this.emit('delivery:failed', { messageId, failedPeers });
        });

        // Start Components
        await this.wsServer.start();
        this.discovery.start();
        this.metricsReporter.start();

        // Initialize GC timer (runs gc() every 5 seconds)
        this.gcInterval = setInterval(() => {
            this.gossipEngine.topicRouter.gc(Date.now());
        }, 5000);

        // Initialize Refresh timer (broadcasts SUB_AD heartbeats for local subscriptions every 15 seconds)
        this.refreshInterval = setInterval(() => {
            this._refreshSubscriptions();
        }, 15000);

        logger.info({ event: 'node_started' });
    }

    /**
     * Sends a gossip message to a topic.
     */
    publish(topic, content) {
        const publicKey = this.securityManager.keyManager.getPublicKey();
        const message = MessageFactory.createChat(this.config.peerId, content, topic, publicKey);
        this.securityManager.signOutgoingMessage(message);
        this.gossipEngine.receiveMessage(message, null); // Pass null as sender for self-origination
        return message.id;
    }

    /**
     * Sends a direct message to a specific peer.
     * DMs are just gossip messages scoped to a topic named after the peerId.
     */
    sendDM(peerId, content) {
        return this.publish(`dm:${peerId}`, content);
    }

    _advertiseSubscription(topic, action = 'JOIN') {
        const seq = (this.localSequences.get(topic) || 0) + 1;
        this.localSequences.set(topic, seq);

        const publicKey = this.securityManager.keyManager.getPublicKey();
        const msg = MessageFactory.createSubAd(
            this.config.peerId,
            topic,
            seq,
            action,
            [], // path starts empty
            publicKey
        );

        this.securityManager.signOutgoingMessage(msg);
        this.gossipEngine.receiveMessage(msg, null);
    }

    _refreshSubscriptions() {
        for (const topic of this.localSubscriptions) {
            this._advertiseSubscription(topic, 'JOIN');
        }
    }

    subscribe(topic) {
        if (this.localSubscriptions.has(topic)) return;
        this.localSubscriptions.add(topic);
        this._advertiseSubscription(topic, 'JOIN');
    }

    unsubscribe(topic) {
        if (!this.localSubscriptions.has(topic)) return;
        this.localSubscriptions.delete(topic);
        this._advertiseSubscription(topic, 'LEAVE');
    }

    async stop() {
        if (this.gcInterval) {
            clearInterval(this.gcInterval);
            this.gcInterval = null;
        }
        if (this.refreshInterval) {
            clearInterval(this.refreshInterval);
            this.refreshInterval = null;
        }
        this.discovery.stop();
        this.metricsReporter.stop();
        await this.wsServer.stop();
        this.connectionPool.clear();
        if (this.db) await this.db.close();
        logger.info({ event: 'node_stopped' });
    }
}
