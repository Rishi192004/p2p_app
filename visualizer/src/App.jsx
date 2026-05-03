/**
 * App.jsx
 * Root component — assembles layout: graph | controls | metrics | log.
 */

import NetworkGraph from './components/NetworkGraph';
import MetricsDashboard from './components/MetricsDashboard';
import ControlPanel from './components/ControlPanel';
import StatusLog from './components/StatusLog';
import { useGossipState } from './hooks/useGossipState';

export default function App() {
  const {
    nodes, edges, deadNodes, activeEdge, litNodes,
    metrics, isAnimating,
    fanout, setFanout,
    hopLatency, setHopLatency,
    statusLog,
    sendMessage, killNode, healNetwork, reset,
  } = useGossipState();

  return (
    <div className="app-root">
      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <header className="app-header">
        <div className="header-left">
          <span className="header-logo">◉</span>
          <div>
            <h1 className="header-title">P2P Gossip Network</h1>
            <p className="header-subtitle">Interactive simulation · Distributed systems demo</p>
          </div>
        </div>
        <div className="header-pills">
          <span className="pill pill-blue">Gossip Protocol</span>
          <span className="pill pill-green">Fault Tolerant</span>
          <span className="pill pill-purple">Self-Healing</span>
        </div>
      </header>

      {/* ── Main layout ─────────────────────────────────────────────────────── */}
      <main className="app-main">

        {/* Left: graph + log */}
        <section className="left-pane">
          <div className="graph-card">
            <div className="card-label">Network Topology</div>
            <NetworkGraph
              nodes={nodes}
              edges={edges}
              deadNodes={deadNodes}
              activeEdge={activeEdge}
              litNodes={litNodes}
            />
          </div>
          <StatusLog entries={statusLog} />
        </section>

        {/* Center: controls */}
        <section className="center-pane">
          <ControlPanel
            onSend={sendMessage}
            onKill={killNode}
            onHeal={healNetwork}
            onReset={reset}
            isAnimating={isAnimating}
            deadNodes={deadNodes}
            fanout={fanout}
            setFanout={setFanout}
            hopLatency={hopLatency}
            setHopLatency={setHopLatency}
          />
        </section>

        {/* Right: metrics dashboard */}
        <section className="right-pane">
          <MetricsDashboard metrics={metrics} />
        </section>

      </main>

      {/* ── Footer ──────────────────────────────────────────────────────────── */}
      <footer className="app-footer">
        <span>P2P Gossip Demo · Built for distributed systems interviews</span>
        <span className="footer-sep">|</span>
        <span>Fanout k={fanout} · Nodes A–E · No backend required</span>
      </footer>
    </div>
  );
}
