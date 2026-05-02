import { WSServer } from './wsServer.js';
import { WSClient } from './wsClient.js';
import { ConnectionPool } from './connectionPool.js';

export {
    WSServer,
    WSClient,
    ConnectionPool
};

// === SYSTEM DESIGN NOTES ===
// Tradeoff: A barrel file (index.js) simplifies imports for consumers (e.g., `import { WSServer } from '../transport'`)
// but can lead to circular dependency issues or pulling in unnecessary code if a consumer only needs one specific class.
// What could go wrong at scale: In a massive monorepo or bundle-optimized frontend environment (though less relevant
// for Node.js backends), barrel files can break tree-shaking, bloating the final memory footprint.
// How to improve in production: If the transport layer grows to include dozens of files, consider defining
// specific `exports` paths in package.json (e.g., `"exports": { "./server": "./transport/wsServer.js" }`) 
// to strictly control module boundaries and enforce explicit imports.
