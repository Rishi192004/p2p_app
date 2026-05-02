import pino from 'pino';

/**
 * Structured Logger
 * 
 * We use pino for structured JSON logging. 
 * 
 * === WHY STRUCTURED LOGS? ===
 * In a distributed P2P network, searching through raw text logs across 
 * dozens of nodes is impossible. Structured JSON logs allow us to ingest 
 * logs into aggregation tools (like ELK, Datadog, or Grafana Loki) where 
 * we can perform complex queries (e.g., "Find all events for Message ID X 
 * across the entire network").
 */
const logger = pino({
    level: process.env.LOG_LEVEL || 'info',
    base: {
        pid: process.pid,
        peerId: process.env.PEER_ID || 'unknown'
    },
    timestamp: pino.stdTimeFunctions.isoTime,
    // Add request/message tracing support
    mixin(context, level) {
        return { 
            // We can add global context here if needed
        };
    }
});

/**
 * Creates a child logger for a specific component.
 * @param {string} componentName 
 * @param {Object} [extraContext]
 */
export const createLogger = (componentName, extraContext = {}) => {
    return logger.child({ component: componentName, ...extraContext });
};

export default logger;
