import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LamportClock } from '../../protocol/lamportClock.js';

test('LamportClock', async (t) => {
    await t.test('tick should increment the clock', () => {
        const clock = new LamportClock();
        assert.strictEqual(clock.value, 0);
        
        const t1 = clock.tick();
        assert.strictEqual(t1, 1);
        assert.strictEqual(clock.value, 1);
        
        const t2 = clock.tick();
        assert.strictEqual(t2, 2);
    });

    await t.test('update should handle causal ordering correctly', () => {
        const clock = new LamportClock();
        
        // Scenario 1: Received time is ahead
        clock.update(10);
        assert.strictEqual(clock.value, 11);
        
        // Scenario 2: Local clock is already ahead
        clock.update(5);
        assert.strictEqual(clock.value, 12);
        
        // Scenario 3: Received time equals local clock
        clock.update(12);
        assert.strictEqual(clock.value, 13);
    });
});
