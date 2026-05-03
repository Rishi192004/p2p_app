/**
 * useGossipState.js
 * Central React state + action hooks for the gossip simulation.
 * Keeps all business logic here, components stay purely presentational.
 */

import { useState, useCallback, useRef } from 'react';
import {
  INITIAL_NODES,
  INITIAL_EDGES,
  computeGossipWaves,
  computeHealingEdges,
} from '../simulation/gossipEngine';

// ─── Default settings ─────────────────────────────────────────────────────────
const DEFAULT_FANOUT = 2;
const DEFAULT_HOP_LATENCY_MS = 300; // simulated ms per hop (also used for animation delay)

function makeInitialMetrics() {
  return {
    totalSent: 0,
    delivered: 0,
    duplicatesDropped: 0,
    activeNodes: INITIAL_NODES.length,
    failedNodes: 0,
    throughput: 0,           // msgs/sec (rolling)
    avgLatencyMs: 0,
    peakLatencyMs: 0,
    propagationTimeMs: 0,
    fanout: DEFAULT_FANOUT,
    totalTransmissions: 0,
    theoreticalMin: 0,
    amplificationFactor: 0,
    maxHops: 0,
    reconnectionEvents: 0,
    retryCount: 0,
    latencyHistory: [],      // for sparkline (last 20 values)
  };
}

// ─── Hook ─────────────────────────────────────────────────────────────────────
export function useGossipState() {
  const [nodes, setNodes] = useState(INITIAL_NODES);
  const [edges, setEdges] = useState(INITIAL_EDGES);
  const [deadNodes, setDeadNodes] = useState(new Set());
  const [activeEdge, setActiveEdge] = useState(null);        // { source, target } currently animating
  const [litNodes, setLitNodes] = useState(new Set());       // nodes currently highlighted
  const [metrics, setMetrics] = useState(makeInitialMetrics());
  const [isAnimating, setIsAnimating] = useState(false);
  const [fanout, setFanout] = useState(DEFAULT_FANOUT);
  const [hopLatency, setHopLatency] = useState(DEFAULT_HOP_LATENCY_MS);
  const [statusLog, setStatusLog] = useState(['System ready. Network initialised with 5 nodes.']);

  // Refs to avoid stale closures in animation timeouts
  const metricsRef = useRef(metrics);
  metricsRef.current = metrics;
  const animatingRef = useRef(false);

  const log = useCallback((msg) => {
    setStatusLog(prev => [`[${new Date().toLocaleTimeString()}] ${msg}`, ...prev].slice(0, 50));
  }, []);

  // ── Send gossip message ─────────────────────────────────────────────────────
  const sendMessage = useCallback(() => {
    if (animatingRef.current) return;
    animatingRef.current = true;
    setIsAnimating(true);

    const msgId = `msg-${Date.now()}`;
    const startTime = Date.now();
    const currentDeadNodes = new Set(deadNodes); // snapshot
    const currentEdges = edges;                  // snapshot

    const { waves, reached } = computeGossipWaves({
      msgId,
      sourceNode: 'A',
      edges: currentEdges,
      deadNodes: currentDeadNodes,
      fanout,
      hopLatencyMs: hopLatency,
    });

    const totalTx = waves.reduce((s, w) => s + w.length, 0);
    const allLatencies = waves.flatMap(w => w.map(e => e.latencyMs));
    const avgLat = allLatencies.length
      ? Math.round(allLatencies.reduce((a, b) => a + b, 0) / allLatencies.length)
      : 0;
    const peakLat = allLatencies.length ? Math.max(...allLatencies) : 0;
    const liveCount = nodes.filter(n => !currentDeadNodes.has(n.id)).length;
    const theoreticalMin = liveCount - 1; // minimum spanning tree edges
    const deliveredCount = reached.length - 1; // exclude source

    log(`Gossip ${msgId} started from Node-A → targeting ${liveCount} nodes, fanout=${fanout}`);

    // Animate waves sequentially
    let waveIndex = 0;
    let txIndex = 0;
    let elapsedMs = 0;

    const scheduleNext = () => {
      if (waveIndex >= waves.length) {
        // Done
        const propagationMs = Date.now() - startTime;
        setActiveEdge(null);

        // Calculate throughput (msgs delivered / propagation seconds)
        const throughput = propagationMs > 0
          ? Math.round((deliveredCount / propagationMs) * 1000)
          : deliveredCount;

        setMetrics(prev => {
          const newHistory = [...prev.latencyHistory, avgLat].slice(-20);
          return {
            ...prev,
            totalSent: prev.totalSent + 1,
            delivered: prev.delivered + deliveredCount,
            duplicatesDropped: prev.duplicatesDropped + (totalTx - deliveredCount),
            throughput,
            avgLatencyMs: avgLat,
            peakLatencyMs: Math.max(prev.peakLatencyMs, peakLat),
            propagationTimeMs: propagationMs,
            totalTransmissions: prev.totalTransmissions + totalTx,
            theoreticalMin: prev.theoreticalMin + theoreticalMin,
            amplificationFactor: theoreticalMin > 0
              ? parseFloat((totalTx / theoreticalMin).toFixed(2))
              : 0,
            maxHops: Math.max(prev.maxHops, waves.length),
            fanout,
            latencyHistory: newHistory,
          };
        });

        log(`✅ Propagation complete: ${deliveredCount} delivered, ${totalTx - deliveredCount} duplicates, ${waves.length} hops, ${propagationMs}ms`);

        setTimeout(() => {
          setLitNodes(new Set());
          animatingRef.current = false;
          setIsAnimating(false);
        }, 600);
        return;
      }

      const wave = waves[waveIndex];
      if (txIndex >= wave.length) {
        waveIndex++;
        txIndex = 0;
        scheduleNext();
        return;
      }

      const tx = wave[txIndex];
      elapsedMs += tx.latencyMs;
      txIndex++;

      setTimeout(() => {
        // Highlight edge
        setActiveEdge({ source: tx.from, target: tx.to });
        // Light up destination node
        setLitNodes(prev => new Set([...prev, tx.to]));
        scheduleNext();
      }, tx.latencyMs);
    };

    // Light up source immediately
    setLitNodes(new Set(['A']));
    scheduleNext();
  }, [deadNodes, edges, nodes, fanout, hopLatency, log]);

  // ── Kill Node-C ─────────────────────────────────────────────────────────────
  const killNode = useCallback((nodeId = 'C') => {
    if (deadNodes.has(nodeId)) return;
    log(`💀 Node-${nodeId} killed — removing from network`);

    // Update both state slices separately to avoid stale closure issues
    const newDeadNodes = new Set([...deadNodes, nodeId]);
    setDeadNodes(newDeadNodes);

    const failedCount = newDeadNodes.size;
    const activeCount = nodes.length - failedCount;
    setMetrics(m => ({
      ...m,
      activeNodes: activeCount,
      failedNodes: failedCount,
    }));
  }, [deadNodes, nodes, log]);

  // ── Self-heal: reconnect orphaned nodes ─────────────────────────────────────
  const healNetwork = useCallback(() => {
    const newEdges = computeHealingEdges(edges, deadNodes, nodes);
    if (newEdges.length === 0) {
      log('ℹ️  Network already connected — no healing required');
      return;
    }
    setEdges(prev => [...prev, ...newEdges]);
    setMetrics(m => ({
      ...m,
      reconnectionEvents: m.reconnectionEvents + newEdges.length,
    }));
    log(`🔗 Self-heal: added ${newEdges.length} new connection(s) to restore connectivity`);
  }, [edges, deadNodes, nodes, log]);

  // ── Reset everything ─────────────────────────────────────────────────────────
  const reset = useCallback(() => {
    setNodes(INITIAL_NODES);
    setEdges(INITIAL_EDGES);
    setDeadNodes(new Set());
    setActiveEdge(null);
    setLitNodes(new Set());
    setMetrics({ ...makeInitialMetrics(), fanout });
    setIsAnimating(false);
    animatingRef.current = false;
    log('🔄 Network reset to initial state');
  }, [fanout, log]);

  return {
    nodes, edges, deadNodes, activeEdge, litNodes,
    metrics, isAnimating, fanout, setFanout, hopLatency, setHopLatency,
    statusLog,
    sendMessage, killNode, healNetwork, reset,
  };
}
