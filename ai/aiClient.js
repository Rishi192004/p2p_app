import { createLogger } from '../utils/logger.js';

const logger = createLogger('aiClient');

/**
 * AI client for communicating with the local FastAPI summarization service.
 */
export class AIClient {
    /**
     * @param {string} aiServiceUrl - URL of the FastAPI AI service (e.g. http://localhost:8001)
     */
    constructor(aiServiceUrl = 'http://localhost:8001') {
        this.aiServiceUrl = aiServiceUrl.replace(/\/$/, '');
    }

    /**
     * Sends recent messages to the AI microservice for summarization.
     * 
     * @param {string} topic - The chat topic (e.g., "sports")
     * @param {'summary'|'keypoints'} mode - Summarization output mode
     * @param {Array<Object>} messages - Array of chat messages
     * @param {number} [timeoutMs=10000] - Request timeout limit in milliseconds
     * @returns {Promise<string|null>} The generated summary/keypoints, or null on error
     */
    async summarizeMessages(topic, mode, messages, timeoutMs = 10000) {
        if (!messages || messages.length === 0) {
            logger.debug({ event: 'summarize_skipped', reason: 'no_messages' });
            return null;
        }

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

        const url = `${this.aiServiceUrl}/summarize`;
        const payload = {
            topic,
            mode,
            messages: messages.map(msg => ({
                id: msg.id,
                sender: msg.sender,
                topic: msg.topic || topic,
                payload: msg.payload,
                createdAt: msg.createdAt
            }))
        };

        try {
            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(payload),
                signal: controller.signal
            });

            clearTimeout(timeoutId);

            if (!response.ok) {
                const errText = await response.text();
                logger.warn({ event: 'summarize_service_error', status: response.status, error: errText }, 'AI service returned error status');
                return null;
            }

            const data = await response.json();
            return data.summary || null;
        } catch (error) {
            clearTimeout(timeoutId);
            if (error.name === 'AbortError') {
                logger.warn({ event: 'summarize_timeout', timeoutMs, topic }, 'AI service request timed out');
            } else {
                logger.warn({ event: 'summarize_connection_error', error: error.message, topic }, 'Could not connect to AI service; running in degraded fallback mode');
            }
            return null; // Fallback gracefully
        }
    }
}
export default AIClient;
