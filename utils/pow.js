import { createRequire } from 'module';
import { createLogger } from './logger.js';

const require = createRequire(import.meta.url);
const logger = createLogger('pow');

let nativePow = null;

try {
    // Try to load the native addon
    nativePow = require('../build/Release/pow.node');
    logger.info({ event: 'native_pow_loaded' }, 'Successfully loaded native C++ PoW engine');
} catch (err) {
    logger.warn({ event: 'native_pow_fallback', error: err.message }, 'Could not load native PoW engine. Falling back to JavaScript implementation.');
}

/**
 * JS Fallback for simple_hash
 */
function jsSimpleHash(data) {
    let hash = 0x811c9dc5;
    for (let i = 0; i < data.length; i++) {
        hash ^= data.charCodeAt(i);
        hash = Math.imul(hash, 0x01000193);
    }
    return hash >>> 0; // Convert to unsigned 32-bit
}

/**
 * API Wrapper: Prefers native C++, falls back to JS
 */
export const pow = {
    solvePuzzle: (data, difficulty) => {
        if (nativePow) {
            return nativePow.solvePuzzle(data, difficulty);
        }
        
        // JS Implementation
        let nonce = 0;
        while (true) {
            const attempt = data + nonce;
            const hash = jsSimpleHash(attempt);
            if (hash % difficulty === 0) return nonce;
            nonce++;
            if (nonce > 1000000) break;
        }
        return 0;
    },

    verifyPuzzle: (data, difficulty, nonce) => {
        if (nativePow) {
            return nativePow.verifyPuzzle(data, difficulty, nonce);
        }
        
        const attempt = data + nonce;
        const hash = jsSimpleHash(attempt);
        return (hash % difficulty === 0);
    },
    
    isNative: () => nativePow !== null
};
