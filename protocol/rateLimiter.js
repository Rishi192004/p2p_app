import { EventEmitter } from 'events';
import { createLogger } from '../utils/logger.js';
import collector from '../metrics/collector.js';
import config from '../config/default.js';

const logger = createLogger('rateLimiter');

/**
 * Rate Limiter
 * 
 * Protects the node from spam and broadcast storms by throttling incoming messages.
 * 
 * === RATE LIMITING ALGORITHMS TRADEOFF ===
 * 1. Fixed Window: Extremely simple to implement (reset counter every minute), but 
 *    suffers from the "stampede" problem at window boundaries (e.g., 200 messages at 
 *    0:59, 200 at 1:01).
 * 2. Leaky Bucket: Smooths out bursts entirely, processing messages at a strictly 
 *    constant rate. Great for routers, but bad for chat systems where users often 
 *    send 3-4 messages in quick succession ("bursts").
 * 3. Token Bucket: We use this because it combines a bounded average rate with 
 *    burst tolerance. A user can exhaust their 20 tokens instantly in a chat burst, 
 *    but then must wait for the bucket to refill at 5 tokens/second, preventing 
 *    sustained flooding while preserving a snappy UX.
 * 
 * === DECENTRALIZED BANNING RISKS ===
 * Banning a peer purely by IP address in a decentralized network is highly risky. 
 * Often, multiple legitimate nodes (or users) sit behind a single NAT (Network 
 * Address Translation) gateway, sharing the same public IP. Banning the IP bans 
 * the entire office/household. 
 * 
 * Smarter Approach: 
 * We ban by cryptographic `peerId` rather than IP, meaning the malicious identity 
 * is banned regardless of where they connect from. However, identities are cheap 
 * (Sybil attack). A robust production system would implement Proof of Work (PoW) 
 * for identity generation or require a decentralized Web of Trust / staking mechanism 
 * to make acquiring a valid `peerId` expensive.
 */
export class RateLimiter extends EventEmitter {
    constructor(options = {}) {
        super();
        
        this.capacity = options.capacity || config.RATE_LIMIT_CAPACITY || 20;
        this.refillRatePerSec = options.refillRate || config.RATE_LIMIT_REFILL_RATE || 5;
        
        /**
         * Token bucket state per peer.
         * @type {Map<string, { tokens: number, lastRefill: number }>}
         */
        this.buckets = new Map();
        
        /**
         * Tracks rate limit violations for the banning logic.
         * @type {Map<string, number[]>} Maps peerId to an array of violation timestamps.
         */
        this.violations = new Map();
        
        /**
         * Active bans.
         * @type {Map<string, number>} Maps peerId to ban expiration timestamp.
         */
        this.bannedPeers = new Map();
        
        this.BAN_THRESHOLD = 10;
        this.VIOLATION_WINDOW_MS = 60 * 1000; // 60 seconds
        this.BAN_DURATION_MS = 5 * 60 * 1000; // 5 minutes
    }

    /**
     * Internal token refill logic.
     * @param {string} peerId 
     */
    _refill(peerId) {
        const now = Date.now();
        if (!this.buckets.has(peerId)) {
            this.buckets.set(peerId, { tokens: this.capacity, lastRefill: now });
            return;
        }

        const bucket = this.buckets.get(peerId);
        const timePassedSec = (now - bucket.lastRefill) / 1000;
        
        if (timePassedSec > 0) {
            const tokensToAdd = timePassedSec * this.refillRatePerSec;
            bucket.tokens = Math.min(this.capacity, bucket.tokens + tokensToAdd);
            bucket.lastRefill = now;
        }
    }

    /**
     * Checks if a peer is allowed to send a message.
     * @param {string} peerId 
     * @returns {boolean} true if allowed, false if rate limited or banned.
     */
    checkLimit(peerId) {
        const now = Date.now();
        
        // 1. Check if explicitly banned
        if (this.bannedPeers.has(peerId)) {
            if (now > this.bannedPeers.get(peerId)) {
                this.bannedPeers.delete(peerId); // Ban expired
                logger.info({ event: 'ban_expired', peerId });
            } else {
                return false;
            }
        }

        // 2. Token Bucket check
        this._refill(peerId);
        const bucket = this.buckets.get(peerId);

        if (bucket.tokens >= 1) {
            bucket.tokens -= 1;
            return true;
        }

        // --- RATE LIMITED ---
        this.emit('peer:rate_limited', peerId);
        logger.warn({ event: 'rate_limited', peerId });
        
        // 3. Track violation for potential banning
        this._recordViolation(peerId, now);

        return false;
    }

    /**
     * Records a rate limit violation and determines if a temporary ban is needed.
     * @param {string} peerId 
     * @param {number} timestamp 
     */
    _recordViolation(peerId, timestamp) {
        if (!this.violations.has(peerId)) {
            this.violations.set(peerId, []);
        }

        const history = this.violations.get(peerId);
        history.push(timestamp);

        // Prune old violations outside the 60s window
        const cutoff = timestamp - this.VIOLATION_WINDOW_MS;
        while (history.length > 0 && history[0] < cutoff) {
            history.shift();
        }

        if (this.shouldBan(peerId)) {
            this._applyBan(peerId, timestamp);
        }
    }

    /**
     * Returns true if peer has been rate limited > 10 times in 60s.
     * @param {string} peerId 
     * @returns {boolean}
     */
    shouldBan(peerId) {
        const history = this.violations.get(peerId);
        if (!history) return false;
        
        return history.length > this.BAN_THRESHOLD;
    }

    /**
     * Applies a temporary 5-minute ban.
     * @param {string} peerId 
     * @param {number} timestamp 
     */
    _applyBan(peerId, timestamp) {
        const banExpiration = timestamp + this.BAN_DURATION_MS;
        this.bannedPeers.set(peerId, banExpiration);
        
        // Clear violations so they don't get immediately re-banned upon expiration
        this.violations.delete(peerId);
        
        this.emit('peer:banned', peerId);
        logger.error({ event: 'peer_banned', peerId, durationMs: this.BAN_DURATION_MS });
    }
}
