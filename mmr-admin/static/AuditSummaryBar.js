/**
 * Audit Summary Bar Component
 * Summary statistics and export button for audit results
 */

const AuditSummaryBar = ({
  auditResults,
  showNotTracedOnly,
  filteredResultsCount,
  onExport,
}) => {
  if (!auditResults?.summary) return null;

  return (
    <div style={{ backgroundColor: 'rgba(56,189,248,0.08)', border: '1px solid rgba(56,189,248,0.25)', borderRadius: '6px', padding: '16px', marginBottom: '20px' }}>
      <h3 style={{ margin: '0 0 12px 0', fontSize: '14px', color: 'var(--text2)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>📊 Audit Summary</h3>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '10px', marginBottom: '12px' }}>
        {[
          { label: 'Total Transactions', value: auditResults.summary.total_transactions || 0, color: 'var(--text)' },
          { label: 'Traced Members',     value: auditResults.summary.traced_members || 0,     color: 'var(--accent)' },
          { label: '✓ Matched',          value: auditResults.summary.expirations_matched || 0, color: '#4ade80' },
          { label: '✗ Mismatched',       value: auditResults.summary.expirations_mismatched || 0, color: '#f87171' },
          { label: '⚠ Not Traced',       value: auditResults.summary.not_traced || 0,          color: '#fb923c' },
        ].map(({ label, value, color }) => (
          <div key={label} style={{ backgroundColor: 'var(--surface)', padding: '12px', borderRadius: '6px', border: '1px solid var(--border)', textAlign: 'center' }}>
            <div style={{ fontSize: '11px', color: 'var(--text2)', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.4px' }}>{label}</div>
            <div style={{ fontSize: '26px', fontWeight: 'bold', color }}>{value}</div>
          </div>
        ))}
      </div>
      {showNotTracedOnly && filteredResultsCount > 0 && (
        <div style={{ marginBottom: '10px', fontSize: '12px', color: '#fb923c' }}>
          Showing {filteredResultsCount} Not Traced transaction{filteredResultsCount !== 1 ? 's' : ''}
        </div>
      )}
      <button
        onClick={onExport}
        style={{ padding: '10px 20px', backgroundColor: '#007d2f', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '14px', fontWeight: '600' }}
      >
        📥 Export CSV
      </button>
    </div>
  );
};

window.AuditSummaryBar = AuditSummaryBar;
