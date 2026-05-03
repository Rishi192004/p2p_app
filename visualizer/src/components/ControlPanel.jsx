/**
 * ControlPanel.jsx
 * All simulation controls: send message, kill node, heal, reset, fanout slider.
 */

export default function ControlPanel({
  onSend, onKill, onHeal, onReset,
  isAnimating, deadNodes,
  fanout, setFanout,
  hopLatency, setHopLatency,
}) {
  const nodeC_dead = deadNodes.has('C');

  return (
    <div className="control-panel">
      <div className="control-header">🎮 Controls</div>

      {/* Primary actions */}
      <div className="control-group">
        <button
          id="btn-send"
          className="btn btn-primary"
          onClick={onSend}
          disabled={isAnimating}
        >
          {isAnimating ? (
            <>
              <span className="btn-spinner" /> Propagating…
            </>
          ) : (
            '📨 Send Message from A'
          )}
        </button>

        <button
          id="btn-kill"
          className="btn btn-danger"
          onClick={() => onKill('C')}
          disabled={nodeC_dead || isAnimating}
        >
          {nodeC_dead ? '☠ Node-C Already Dead' : '💀 Kill Node-C'}
        </button>

        <button
          id="btn-heal"
          className="btn btn-success"
          onClick={onHeal}
          disabled={isAnimating || !nodeC_dead}
          title="Reconnect orphaned nodes after failure"
        >
          🔗 Self-Heal Network
        </button>

        <button
          id="btn-reset"
          className="btn btn-ghost"
          onClick={onReset}
          disabled={isAnimating}
        >
          🔄 Reset Network
        </button>
      </div>

      {/* Sliders */}
      <div className="control-group">
        <div className="slider-row">
          <label htmlFor="fanout-slider" className="slider-label">
            Fanout (k)
            <span className="slider-value">{fanout}</span>
          </label>
          <input
            id="fanout-slider"
            type="range"
            min={1}
            max={4}
            step={1}
            value={fanout}
            onChange={e => setFanout(Number(e.target.value))}
            className="slider"
            disabled={isAnimating}
          />
          <div className="slider-ticks">
            {[1, 2, 3, 4].map(v => (
              <span key={v} className={fanout === v ? 'tick tick-active' : 'tick'}>{v}</span>
            ))}
          </div>
        </div>

        <div className="slider-row">
          <label htmlFor="latency-slider" className="slider-label">
            Hop Latency
            <span className="slider-value">{hopLatency}ms</span>
          </label>
          <input
            id="latency-slider"
            type="range"
            min={100}
            max={800}
            step={50}
            value={hopLatency}
            onChange={e => setHopLatency(Number(e.target.value))}
            className="slider"
            disabled={isAnimating}
          />
        </div>
      </div>

      {/* Legend */}
      <div className="legend">
        <div className="legend-item">
          <span className="legend-dot dot-active" /> Active node
        </div>
        <div className="legend-item">
          <span className="legend-dot dot-lit" /> Message received
        </div>
        <div className="legend-item">
          <span className="legend-dot dot-dead" /> Failed node
        </div>
        <div className="legend-item">
          <span className="legend-line line-new" /> New (healed) edge
        </div>
      </div>
    </div>
  );
}
