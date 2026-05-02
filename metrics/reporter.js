import http from 'http';
import collector from './collector.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('metricsReporter');

/**
 * Metrics Reporter
 * 
 * Periodically logs metrics and exposes an HTTP endpoint for scraping.
 * 
 * === PROMETHEUS PATTERN ===
 * This reporter mimics the Prometheus "Exposition Format." While we return 
 * raw JSON for simplicity, a production system would return a text format 
 * that Prometheus/Grafana can scrape every few seconds. This allows for 
 * real-time dashboards and alerting.
 */
export class MetricsReporter {
    constructor(port = 9090) {
        this.port = port;
        this.interval = null;
        this.server = null;
        this.startTime = Date.now();
    }

    start() {
        // 1. Periodic JSON logging (every 30s)
        this.interval = setInterval(() => {
            const snapshot = collector.getSnapshot();
            logger.info({ event: 'metrics_snapshot', metrics: snapshot });
        }, 30000);

        // 2. HTTP Server for scraping
        this.server = http.createServer((req, res) => {
            if (req.url === '/metrics' && req.method === 'GET') {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify(collector.getSnapshot(), null, 2));
            } else if (req.url === '/health' && req.method === 'GET') {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                    status: 'ok',
                    uptime: Math.floor((Date.now() - this.startTime) / 1000),
                    active_peers: collector.gauges.get('active_peers') || 0
                }));
            } else {
                res.writeHead(404);
                res.end();
            }
        });

        this.server.listen(this.port, () => {
            logger.info({ event: 'http_metrics_started', port: this.port }, `Metrics HTTP server listening on port ${this.port}`);
        });
    }

    stop() {
        if (this.interval) clearInterval(this.interval);
        if (this.server) this.server.close();
        logger.info({ event: 'metrics_reporter_stopped' });
    }
}
