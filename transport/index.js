/**
 * transport/index.js — Adaptive Transport Factory
 *
 * Selection logic:
 *   1. Detect OS platform (linux vs. everything else).
 *   2. Detect whether the native_transport.node binary has been built.
 *   3. If both pass → use the epoll-based NativeServer / NativeClient.
 *   4. Otherwise → fall back silently to WSServer / WSClient.
 *
 * This file is the ONLY place in the codebase that knows which transport
 * is active. Consumers always import { createServer, createClient } and
 * receive an object with the same event API regardless of transport.
 *
 * SYSTEM DESIGN NOTES:
 *   Tradeoff: A factory pattern adds a layer of indirection but keeps all
 *   transport-selection logic in one place, preventing it from leaking into
 *   business logic (gossip, security, etc.).
 *   What could go wrong: If the native build is stale (e.g. Node.js was
 *   upgraded, invalidating the .node ABI), require() will throw and we fall
 *   back gracefully — no crash, just a logged warning.
 *   How to improve: In CI, assert that the native build succeeds on Linux
 *   so we catch ABI mismatches before they reach production.
 */

import os from 'os';
import { WSServer } from './wsServer.js';
import { WSClient } from './wsClient.js';
import { ConnectionPool } from './connectionPool.js';
import { NativeServer, NativeClient, isNativeAvailable } from './nativeTransport.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('transport/factory');

// ── Transport detection ───────────────────────────────────────────────────────

const onLinux = os.platform() === 'linux';
const useNative = onLinux && isNativeAvailable;

if (useNative) {
    logger.info(
        { transport: 'native-epoll' },
        '🚀  Using native epoll TCP transport (O(1) event loop, edge-triggered)'
    );
} else {
    logger.info(
        { transport: 'websocket', reason: onLinux ? 'addon-not-built' : 'non-linux-platform' },
        '🔌  Using WebSocket transport (graceful fallback)'
    );
}

// ── Factory functions (preferred API) ────────────────────────────────────────

/**
 * Create the appropriate server for this platform.
 * @param {number} port
 * @param {string} localPeerId
 * @param {string|null} [localPublicKey]
 * @returns {WSServer | NativeServer}
 */
export function createServer(port, localPeerId, localPublicKey = null) {
    return useNative
        ? new NativeServer(port, localPeerId, localPublicKey)
        : new WSServer(port, localPeerId, localPublicKey);
}

/**
 * Create the appropriate client for this platform.
 * @param {string} host
 * @param {number} port
 * @param {string} localPeerId
 * @param {string|null} [remotePeerId]
 * @param {string|null} [localPublicKey]
 * @returns {WSClient | NativeClient}
 */
export function createClient(host, port, localPeerId, remotePeerId = null, localPublicKey = null) {
    return useNative
        ? new NativeClient(host, port, localPeerId, remotePeerId, localPublicKey)
        : new WSClient(host, port, localPeerId, remotePeerId, localPublicKey);
}

/** Expose the active transport name for observability / diagnostics. */
export const activeTransport = useNative ? 'native-epoll' : 'websocket';

// ── Named class exports (backwards-compatible with existing imports) ──────────

export {
    WSServer,
    WSClient,
    ConnectionPool,
    NativeServer,
    NativeClient,
    isNativeAvailable,
};
