import { EventEmitter } from 'events';
import config from '../config/default.js';
import state from './state.js';
import { MessageFactory } from '../protocol/messageFactory.js';

/**
 * Active Failure Detection
 * 
 * Phi-accrual-inspired Threshold Logic:
 * A simple boolean timeout (e.g., if > 10s then dead) is highly brittle in distributed 
 * systems. Network latencies follow long-tail distributions, not normal distributions.
 * While we are using a simplified threshold approach here (Suspicion phase followed by 
 * Death phase), the philosophy is the same as phi-accrual failure detectors (like in Akka/Cassandra):
 * Failure is a scale, not a boolean. 
 * By marking a node SUSPECTED first, we can stop routing critical traffic to it while 
 * avoiding the high cost of fully tearing down connections and re-synchronizing state if 
 * it recovers shortly after.
 */
export class HeartbeatManager extends EventEmitter {
    constructor(localPeerId, connectionPool, peerManager) {
        super();
        this.localPeerId = localPeerId;
        this.connectionPool = connectionPool;
        this.peerManager = peerManager;
        this.timer = null;
    }

    start() {
        if (this.timer) return;
        this.timer = setInterval(() => this._tick(), config.HEARTBEAT_INTERVAL_MS);
    }

    stop() {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }
    }

    _tick() {
        const now = Date.now();
        
        // 1. Send HEARTBEAT to all ACTIVE peers
        const heartbeatMsg = MessageFactory.createHeartbeat(this.localPeerId);
        
        for (const [peerId, peerInfo] of state.getPeerEntries()) {
            if (peerInfo.status === 'ACTIVE') {
                // Send heartbeat directly via connection pool
                const client = this.connectionPool.outboundConnections.get(peerId);
                if (client && client.isConnected) {
                    client.send(heartbeatMsg);
                }
            }

            // 2. Check timeouts
            const timeSinceLastSeen = now - peerInfo.lastSeen;

            if (peerInfo.status === 'ACTIVE' && timeSinceLastSeen > config.PEER_TIMEOUT_MS) {
                // Transition to SUSPECTED
                peerInfo.status = 'SUSPECTED';
                state.setPeer(peerId, peerInfo);
                this.emit('peer:suspected', { peerId, timestamp: now, reason: `No heartbeat for ${timeSinceLastSeen}ms` });
            } 
            else if (peerInfo.status === 'SUSPECTED' && timeSinceLastSeen > 2 * config.PEER_TIMEOUT_MS) {
                // Transition to DEAD
                this.emit('peer:dead', { peerId, timestamp: now, reason: `Suspected timeout exceeded (${timeSinceLastSeen}ms)` });
                this.peerManager.removePeer(peerId, 'Heartbeat timeout');
            }
        }
    }
}
