/**
 * gossipEngine.js
 * Pure simulation logic for P2P gossip propagation.
 * No React deps — driven by React state externally via callbacks.
 */

// ─── Initial topology ────────────────────────────────────────────────────────

export const INITIAL_NODES = [
  { id: 'A', label: 'Node-A', x: 300, y: 180 },
  { id: 'B', label: 'Node-B', x: 500, y: 100 },
  { id: 'C', label: 'Node-C', x: 520, y: 310 },
  { id: 'D', label: 'Node-D', x: 160, y: 320 },
  { id: 'E', label: 'Node-E', x: 370, y: 420 },
];

// Adjacency list – undirected edges
export const INITIAL_EDGES = [
  { source: 'A', target: 'B' },
  { source: 'A', target: 'C' },
  { source: 'A', target: 'D' },
  { source: 'B', target: 'C' },
  { source: 'C', target: 'E' },
  { source: 'D', target: 'E' },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Build neighbour map from edge list, excluding dead nodes */
export function buildAdjacency(edges, deadNodes = new Set()) {
  const adj = {};
  for (const e of edges) {
    if (deadNodes.has(e.source) || deadNodes.has(e.target)) continue;
    if (!adj[e.source]) adj[e.source] = [];
    if (!adj[e.target]) adj[e.target] = [];
    adj[e.source].push(e.target);
    adj[e.target].push(e.source);
  }
  return adj;
}

/** Pick k random unique items from an array */
export function sampleK(arr, k) {
  const shuffled = [...arr].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, k);
}

// ─── Gossip step emitter ──────────────────────────────────────────────────────

/**
 * Compute all propagation steps for one gossip round.
 * Returns an array of "wave" objects, each wave = list of transmissions.
 *
 * A transmission: { from, to, msgId, hop, latencyMs }
 *
 * This is synchronously computed up-front; the caller animates step-by-step.
 */
export function computeGossipWaves({ msgId, sourceNode, edges, deadNodes, fanout, hopLatencyMs }) {
  const adj = buildAdjacency(edges, deadNodes);
  const seen = new Set([sourceNode]);          // nodes that received the message
  const waves = [];                            // array of waves (each = array of tx events)
  let frontier = [sourceNode];                 // current propagation frontier

  while (frontier.length > 0) {
    const waveEvents = [];
    const nextFrontier = [];

    for (const node of frontier) {
      const neighbours = adj[node] || [];
      const targets = sampleK(neighbours, fanout);

      for (const t of targets) {
        // Simulate per-hop latency with jitter (±30%)
        const jitter = 1 + (Math.random() * 0.6 - 0.3);
        const latencyMs = Math.round(hopLatencyMs * jitter);

        waveEvents.push({ from: node, to: t, msgId, hop: waves.length + 1, latencyMs });

        if (!seen.has(t)) {
          seen.add(t);
          nextFrontier.push(t);
        }
        // If already seen → duplicate (we still record it for metrics)
      }
    }

    if (waveEvents.length > 0) waves.push(waveEvents);
    frontier = nextFrontier;
  }

  return { waves, reached: [...seen] };
}

// ─── Self-heal: generate new edges after a node dies ──────────────────────────

/**
 * After killing a node, identify orphaned nodes (< 1 active neighbour)
 * and create new synthetic edges to reconnect them.
 * Returns array of new edge objects.
 */
export function computeHealingEdges(edges, deadNodes, allNodes) {
  const liveNodes = allNodes.filter(n => !deadNodes.has(n.id)).map(n => n.id);
  const adj = buildAdjacency(edges, deadNodes);
  const newEdges = [];

  for (const node of liveNodes) {
    const neighbours = (adj[node] || []).filter(n => !deadNodes.has(n));
    if (neighbours.length === 0) {
      // Orphaned — connect to 2 random peers
      const candidates = liveNodes.filter(n => n !== node);
      const picks = sampleK(candidates, Math.min(2, candidates.length));
      for (const p of picks) {
        const alreadyExists = newEdges.some(
          e => (e.source === node && e.target === p) || (e.source === p && e.target === node)
        );
        if (!alreadyExists) {
          newEdges.push({ source: node, target: p, isNew: true });
        }
      }
    }
  }

  return newEdges;
}
