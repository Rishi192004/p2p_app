/**
 * StatusLog.jsx
 * Scrollable activity log panel showing real-time simulation events.
 */

export default function StatusLog({ entries }) {
  return (
    <div className="status-log">
      <div className="status-log-header">📋 Activity Log</div>
      <div className="status-log-body">
        {entries.map((entry, i) => (
          <div key={i} className={`log-entry ${i === 0 ? 'log-entry-latest' : ''}`}>
            {entry}
          </div>
        ))}
      </div>
    </div>
  );
}
