import { EventEmitter } from 'events';
import state from './state.js';
import collector from '../metrics/collector.js';

/**
 * Peer Lifecycle Management
 * 
 * Peer State Machine:
 * CONNECTING → ACTIVE → SUSPECTED → DEAD → (removed)
 *                   ↑_______________|  (recovered via heartbeat)
 * 
 * We use "suspicion" before declaring a node DEAD to prevent split-brain scenarios 
 * and network churn. A temporary network spike or GC pause on the remote node might 
 * delay a heartbeat. If we instantly declared them DEAD, we would sever TCP connections 
 * and drop routes, causing expensive reconnections and route recalculations. Suspicion 
 * gives a grace period for the node to prove it is still alive.
 */
export class PeerManager extends EventEmitter {
    constructor(connectionPool) {
        super();
        this.connectionPool = connectionPool;
    }

    /**
     * Registers a peer, initiates connection via connectionPool
     * @param {string} peerId 
     * @param {string} host 
     * @param {number} port 
     */
    addPeer(peerId, host, port) {
        if (state.hasPeer(peerId)) {
            return;
        }

        const peerInfo = {
            host,
            port,
            lastSeen: Date.now(),
            status: 'CONNECTING',
            lamportTime: 0
        };

        state.setPeer(peerId, peerInfo);
        this.connectionPool.connect(host, port, peerId);
    }

    /**
     * Marks DEAD, closes connection, removes from state
     * @param {string} peerId 
     */
    removePeer(peerId) {
        const peerInfo = state.getPeer(peerId);
        if (!peerInfo) return;

        peerInfo.status = 'DEAD';
        state.setPeer(peerId, peerInfo); // Update status right before removal
        
        this.connectionPool.disconnect(peerId);
        state.deletePeer(peerId);
        
        collector.set('active_peers', state.getActivePeerCount());
        
        // Structured payload
        this.emit('peer:removed', { peerId, timestamp: Date.now(), reason: 'Explicit removal or DEAD' });
    }

    /**
     * Refreshes lastSeen timestamp.
     * @param {string} peerId 
     * @param {number} lamportTime 
     */
    updateHeartbeat(peerId, lamportTime) {
        const peerInfo = state.getPeer(peerId);
        if (!peerInfo) return;

        peerInfo.lastSeen = Date.now();
        if (lamportTime !== undefined) {
            peerInfo.lamportTime = Math.max(peerInfo.lamportTime, lamportTime);
        }

        const oldStatus = peerInfo.status;
        if (oldStatus !== 'ACTIVE') {
            peerInfo.status = 'ACTIVE';
            state.setPeer(peerId, peerInfo);
            
            if (oldStatus === 'SUSPECTED') {
                this.emit('peer:recovered', { peerId, timestamp: Date.now(), reason: 'Heartbeat received during suspicion' });
            } else if (oldStatus === 'CONNECTING') {
                this.emit('peer:active', { peerId, timestamp: Date.now(), reason: 'First heartbeat received' });
            }

            collector.set('active_peers', state.getActivePeerCount());
        } else {
            state.setPeer(peerId, peerInfo);
        }
    }
}
