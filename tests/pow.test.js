import { pow } from '../utils/pow.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('pow_test');

async function runTest() {
    const data = "test_message_data_" + Date.now();
    const difficulty = 500;

    console.log(`${COLORS.magenta}[POW  ]${COLORS.reset} Native Engine: ${pow.isNative() ? COLORS.green + 'ACTIVE' : COLORS.yellow + 'FALLBACK (JS)'}${COLORS.reset}`);

    // Test Solving
    const startSolve = performance.now();
    const nonce = pow.solvePuzzle(data, difficulty);
    const endSolve = performance.now();

    // Test Verification
    const isValid = pow.verifyPuzzle(data, difficulty, nonce);
    
    console.log(`${COLORS.green}[VERIF]${COLORS.reset} Puzzle solved (Nonce: ${nonce}) and verified: ${isValid ? COLORS.green + 'PASS' : COLORS.red + 'FAIL'}${COLORS.reset}`);
    console.log(`${COLORS.cyan}[METR ]${COLORS.reset} Solve Time: ${(endSolve - startSolve).toFixed(4)}ms`);

    // Performance Benchmark
    const startBench = performance.now();
    for (let i = 0; i < 1000; i++) {
        pow.verifyPuzzle(data, difficulty, nonce);
    }
    const endBench = performance.now();
    console.log(`${COLORS.cyan}[METR ]${COLORS.reset} Throughput: ${((1000 / (endBench - startBench)) * 1000).toFixed(0)} checks/sec`);
}

const COLORS = {
    reset: "\x1b[0m",
    bright: "\x1b[1m",
    green: "\x1b[32m",
    yellow: "\x1b[33m",
    cyan: "\x1b[36m",
    magenta: "\x1b[35m",
    red: "\x1b[31m"
};

runTest().catch(console.error);
