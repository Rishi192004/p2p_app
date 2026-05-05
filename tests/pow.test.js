import { pow } from '../utils/pow.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('pow_test');

async function runTest() {
    const data = "test_message_data_" + Date.now();
    const difficulty = 500; // Find a nonce where hash % 500 == 0

    console.log(`\n--- Proof-of-Work Engine Test ---`);
    console.log(`Native Engine Loaded: ${pow.isNative() ? '✅ YES' : '❌ NO (Using JS Fallback)'}`);
    console.log(`Data: ${data}`);
    console.log(`Difficulty: ${difficulty}`);

    // Test Solving
    const startSolve = performance.now();
    const nonce = pow.solvePuzzle(data, difficulty);
    const endSolve = performance.now();

    console.log(`\nSolution Found: ${nonce}`);
    console.log(`Time Taken: ${(endSolve - startSolve).toFixed(4)}ms`);

    // Test Verification
    const isValid = pow.verifyPuzzle(data, difficulty, nonce);
    console.log(`Verification Result: ${isValid ? '✅ VALID' : '❌ INVALID'}`);

    // Performance Benchmark (JS vs Native if available)
    console.log(`\nRunning 1,000 verifications...`);
    const startBench = performance.now();
    for (let i = 0; i < 1000; i++) {
        pow.verifyPuzzle(data, difficulty, nonce);
    }
    const endBench = performance.now();
    console.log(`1,000 Verifications took: ${(endBench - startBench).toFixed(4)}ms`);
}

runTest().catch(console.error);
