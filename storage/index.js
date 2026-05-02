import { Level } from 'level';
import config from '../config/default.js';
import pino from 'pino';
import { MessageStore } from './messageStore.js';
import { SyncManager } from './syncManager.js';

const logger = pino({ name: 'storage' });

let dbInstance = null;
let messageStoreInstance = null;
let syncManagerInstance = null;

/**
 * Initializes the LevelDB storage and associated managers.
 * 
 * @param {Object} gossipEngine 
 * @param {Object} connectionPool 
 * @returns {Object} { messageStore, syncManager }
 */
export async function initializeStorage(gossipEngine, connectionPool) {
    if (dbInstance) {
        return { messageStore: messageStoreInstance, syncManager: syncManagerInstance };
    }

    try {
        dbInstance = new Level(config.STORAGE_PATH);
        await dbInstance.open();
        
        logger.info({ event: 'storage_initialized', path: config.STORAGE_PATH });

        messageStoreInstance = new MessageStore(dbInstance);
        syncManagerInstance = new SyncManager(dbInstance, messageStoreInstance, gossipEngine, connectionPool);

        // Prune old messages on startup (e.g., older than 7 days)
        const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
        await messageStoreInstance.prune(SEVEN_DAYS_MS);

        return {
            messageStore: messageStoreInstance,
            syncManager: syncManagerInstance
        };
    } catch (err) {
        logger.error({ event: 'storage_initialization_failed', error: err.message });
        throw err;
    }
}

export async function closeStorage() {
    if (dbInstance) {
        await dbInstance.close();
        dbInstance = null;
    }
}

export { MessageStore, SyncManager };
