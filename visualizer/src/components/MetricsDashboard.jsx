/**
 * MetricsDashboard.jsx
 * Live metrics side panel: core, performance, network efficiency, system behaviour.
 * Also renders a tiny sparkline for latency history using inline SVG.
 */

import React from 'react';

// ─── Sparkline ────────────────────────────────────────────────────────────────
function Sparkline({ data, color = '#60a5fa', height = 36, width = 120 }) {
  if (!data || data.length < 2) {
    return <div className="sparkline-empty">No data yet</div>;
  }
  const max = Math.max(...data, 1);
  const points = data.map((v, i) => {
    const x = (i / (data.length - 1)) * width;
    const y = height - (v / max) * height;
    return `${x},${y}`;
  }).join(' ');

  return (
    <svg width={width} height={height} className="sparkline">
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth="2"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

// ─── Metric card ──────────────────────────────────────────────────────────────
function MetricRow({ label, value, unit = '', highlight = false, dim = false }) {
  return (
    <div className={`metric-row ${highlight ? 'metric-highlight' : ''} ${dim ? 'metric-dim' : ''}`}>
      <span className="metric-label">{label}</span>
      <span className="metric-value">
        {value}
        {unit && <span className="metric-unit">{unit}</span>}
      </span>
    </div>
  );
}

function SectionTitle({ icon, title }) {
  return (
    <div className="metric-section-title">
      <span className="metric-section-icon">{icon}</span>
      {title}
    </div>
  );
}

// ─── Dashboard ────────────────────────────────────────────────────────────────
export default function MetricsDashboard({ metrics }) {
  const {
    totalSent, delivered, duplicatesDropped,
    activeNodes, failedNodes,
    throughput, avgLatencyMs, peakLatencyMs, propagationTimeMs,
    fanout, totalTransmissions, theoreticalMin, amplificationFactor,
    maxHops, reconnectionEvents, retryCount,
    latencyHistory,
  } = metrics;

  const highLatency = avgLatencyMs > 500;
  const highAmplification = amplificationFactor > 3;

  return (
    <div className="metrics-panel">
      <div className="metrics-header">
        <span className="metrics-title">📊 Live Metrics</span>
        <span className={`status-badge ${failedNodes > 0 ? 'status-degraded' : 'status-healthy'}`}>
          {failedNodes > 0 ? '⚠ DEGRADED' : '● HEALTHY'}
        </span>
      </div>

      {/* ── Core metrics ────────────────────────────────────────────────────── */}
      <SectionTitle icon="🔥" title="Core Metrics" />
      <div className="metric-group">
        <MetricRow label="Total Messages Sent" value={totalSent} />
        <MetricRow label="Messages Delivered" value={delivered} />
        <MetricRow label="Duplicates Dropped" value={duplicatesDropped} highlight={duplicatesDropped > 5} />
        <MetricRow label="Active Nodes" value={activeNodes} />
        <MetricRow label="Failed Nodes" value={failedNodes} highlight={failedNodes > 0} />
      </div>

      {/* ── Performance ─────────────────────────────────────────────────────── */}
      <SectionTitle icon="⚡" title="Performance" />
      <div className="metric-group">
        <MetricRow label="Throughput" value={throughput} unit=" msg/s" />
        <MetricRow
          label="Avg Latency"
          value={avgLatencyMs}
          unit=" ms"
          highlight={highLatency}
        />
        <MetricRow label="Peak Latency (p99)" value={peakLatencyMs} unit=" ms" />
        <MetricRow label="Propagation Time" value={propagationTimeMs} unit=" ms" />
      </div>

      {/* Latency sparkline */}
      <div className="sparkline-container">
        <span className="sparkline-label">Latency trend</span>
        <Sparkline
          data={latencyHistory}
          color={highLatency ? '#ef4444' : '#60a5fa'}
          width={150}
          height={36}
        />
      </div>

      {/* ── Network efficiency ───────────────────────────────────────────────── */}
      <SectionTitle icon="🌐" title="Network Efficiency" />
      <div className="metric-group">
        <MetricRow label="Fanout (k)" value={fanout} />
        <MetricRow label="Total Transmissions" value={totalTransmissions} />
        <MetricRow label="Theoretical Minimum" value={theoreticalMin} />
        <MetricRow
          label="Amplification Factor"
          value={amplificationFactor.toFixed(2)}
          unit="×"
          highlight={highAmplification}
        />
      </div>

      {highAmplification && (
        <div className="metric-warning">
          ⚠ High amplification — consider reducing fanout k
        </div>
      )}

      {/* ── System behaviour ─────────────────────────────────────────────────── */}
      <SectionTitle icon="🧠" title="System Behaviour" />
      <div className="metric-group">
        <MetricRow label="Max Hops" value={maxHops} />
        <MetricRow label="Reconnection Events" value={reconnectionEvents} />
        <MetricRow label="Message Retry Count" value={retryCount} />
      </div>
    </div>
  );
}
