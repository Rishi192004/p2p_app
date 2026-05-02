/**
 * Metrics Collector
 * 
 * In-memory store for tracking system performance and health.
 */
export class MetricsCollector {
    constructor() {
        this.counters = new Map();
        this.gauges = new Map();
        this.histograms = new Map();
        
        // Reservoir size for histograms
        this.RESERVOIR_SIZE = 1000;
    }

    /**
     * Counter: Only goes up.
     * Use for: total messages, total errors, etc.
     */
    increment(name, value = 1) {
        const current = this.counters.get(name) || 0;
        this.counters.set(name, current + value);
    }

    /**
     * Gauge: Represents a snapshot value that can go up or down.
     * Use for: active connections, current memory usage, etc.
     */
    set(name, value) {
        this.gauges.set(name, value);
    }

    /**
     * Histogram: Tracks the distribution of values.
     * Use for: request latency, storage write time.
     * 
     * === RESERVOIR SAMPLING ===
     * Why: We use reservoir sampling (fixed-size buffer) to ensure that 
     * memory usage remains constant even if the node processes 10 million 
     * messages. We randomly replace old samples with new ones, maintaining 
     * a statistically representative distribution without storing every data point.
     * 
     * === P99 LATENCY ===
     * Why: Average latency is a lie. If 99 messages take 10ms and 1 takes 
     * 10 seconds, the average is ~110ms, which looks "fine." However, that 
     * 1% of users is having a terrible experience. p99 tells us exactly 
     * what the worst-case scenario looks like at scale.
     */
    record(name, value) {
        if (!this.histograms.has(name)) {
            this.histograms.set(name, {
                samples: [],
                count: 0
            });
        }

        const histogram = this.histograms.get(name);
        histogram.count++;

        if (histogram.samples.length < this.RESERVOIR_SIZE) {
            histogram.samples.push(value);
        } else {
            // Randomly replace a sample
            const randomIndex = Math.floor(Math.random() * histogram.count);
            if (randomIndex < this.RESERVOIR_SIZE) {
                histogram.samples[randomIndex] = value;
            }
        }
    }

    /**
     * Calculates percentiles for a histogram.
     */
    #calculatePercentiles(samples) {
        if (samples.length === 0) return { p50: 0, p95: 0, p99: 0 };
        
        const sorted = [...samples].sort((a, b) => a - b);
        const getPercentile = (p) => {
            const index = Math.floor((p / 100) * (sorted.length - 1));
            return sorted[index];
        };

        return {
            p50: getPercentile(50),
            p95: getPercentile(95),
            p99: getPercentile(99)
        };
    }

    getSnapshot() {
        const snapshot = {
            counters: Object.fromEntries(this.counters),
            gauges: Object.fromEntries(this.gauges),
            histograms: {}
        };

        for (const [name, histogram] of this.histograms) {
            snapshot.histograms[name] = {
                ...this.#calculatePercentiles(histogram.samples),
                count: histogram.count
            };
        }

        return snapshot;
    }
}

// Singleton instance
const collector = new MetricsCollector();
export default collector;
