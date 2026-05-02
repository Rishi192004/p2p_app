import test from 'node:test';
import assert from 'node:assert/strict';
import collector, { MetricsCollector } from '../metrics/collector.js';

test('MetricsCollector - Counter', () => {
    const localCollector = new MetricsCollector();
    localCollector.increment('test_counter', 5);
    localCollector.increment('test_counter');
    
    const snapshot = localCollector.getSnapshot();
    assert.strictEqual(snapshot.counters.test_counter, 6);
});

test('MetricsCollector - Gauge', () => {
    const localCollector = new MetricsCollector();
    localCollector.set('test_gauge', 10);
    localCollector.set('test_gauge', 5);
    
    const snapshot = localCollector.getSnapshot();
    assert.strictEqual(snapshot.gauges.test_gauge, 5);
});

test('MetricsCollector - Histogram (Percentiles)', () => {
    const localCollector = new MetricsCollector();
    
    // Fill with values 1 to 100
    for (let i = 1; i <= 100; i++) {
        localCollector.record('test_hist', i);
    }
    
    const snapshot = localCollector.getSnapshot();
    const hist = snapshot.histograms.test_hist;
    
    assert.strictEqual(hist.count, 100);
    // p50 should be around 50
    assert.ok(hist.p50 >= 45 && hist.p50 <= 55);
    // p99 should be around 99
    assert.ok(hist.p99 >= 95 && hist.p99 <= 100);
});

test('MetricsCollector - Reservoir Sampling', () => {
    const localCollector = new MetricsCollector();
    localCollector.RESERVOIR_SIZE = 10;
    
    // Record 100 values
    for (let i = 0; i < 100; i++) {
        localCollector.record('test_reservoir', i);
    }
    
    const snapshot = localCollector.getSnapshot();
    const hist = snapshot.histograms.test_reservoir;
    
    assert.strictEqual(hist.count, 100);
    // Samples should be limited to reservoir size
    assert.strictEqual(localCollector.histograms.get('test_reservoir').samples.length, 10);
});
