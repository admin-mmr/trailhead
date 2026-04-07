/**
 * Reconcile Member Payments Panel
 *
 * Guides admins through running sp_reconcile_member_payments:
 *  1. Dry Run  — preview members whose expiration / status is out of sync
 *  2. Execute  — confirm and apply all fixes in a single transaction
 *
 * The procedure reads MembershipCollectionStart + MembershipYearEnd from
 * the config table; no date inputs are needed here.
 */

window.ReconcilePanel = () => {
  const { useState, useEffect } = React;

  // config preview
  const [config, setConfig]           = useState({ start: '…', yearEnd: '…' });

  // panel state
  const [dryRows, setDryRows]         = useState(null);   // null = not yet run
  const [execRows, setExecRows]       = useState(null);
  const [loading, setLoading]         = useState(false);
  const [error, setError]             = useState('');
  const [confirmed, setConfirmed]     = useState(false);

  // ── Load config values for display ───────────────────────────────
  useEffect(() => {
    const load = async (key) => {
      try {
        const r = await fetch(`/api/config/get?key=${key}`);
        const d = await r.json();
        return d.success ? d.value : '?';
      } catch { return '?'; }
    };
    (async () => {
      const [start, yearEnd] = await Promise.all([
        load('MembershipCollectionStart'),
        load('MembershipYearEnd'),
      ]);
      setConfig({ start, yearEnd });
    })();
  }, []);

  // ── Dry run ───────────────────────────────────────────────────────
  const runDryRun = async () => {
    setLoading(true);
    setError('');
    setDryRows(null);
    setExecRows(null);
    setConfirmed(false);
    try {
      const r = await mmrUtils.api('/api/audit/reconcile', {
        method: 'POST',
        body: JSON.stringify({ dry_run: true }),
      });
      if (!r.success) { setError(r.error || 'Dry run failed'); return; }
      setDryRows(r.rows || []);
    } catch (e) {
      setError(`Error: ${e.message}`);
    } finally {
      setLoading(false);
    }
  };

  // ── Execute ───────────────────────────────────────────────────────
  const runExecute = async () => {
    setLoading(true);
    setError('');
    setExecRows(null);
    try {
      const r = await mmrUtils.api('/api/audit/reconcile', {
        method: 'POST',
        body: JSON.stringify({ dry_run: false }),
      });
      if (!r.success) { setError(r.error || 'Execute failed'); return; }
      setExecRows(r.rows || []);
      setConfirmed(false);
    } catch (e) {
      setError(`Error: ${e.message}`);
    } finally {
      setLoading(false);
    }
  };

  // ── Helpers ───────────────────────────────────────────────────────
  const ResultTable = ({ rows, title, accent }) => {
    if (!rows || rows.length === 0) return (
      <div style={{ padding: '12px 16px', background: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.25)', borderRadius: 4, color: 'var(--text)', marginTop: 12 }}>
        ✓ {title}: No discrepancies found — all members are in sync.
      </div>
    );

    const cols = Object.keys(rows[0]);
    return (
      <div style={{ marginTop: 16 }}>
        <div style={{ fontWeight: 600, marginBottom: 6, color: accent }}>{title} — {rows.length} row(s)</div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr>
                {cols.map(c => (
                  <th key={c} style={{ padding: '6px 10px', textAlign: 'left', borderBottom: '1px solid var(--border)', color: 'var(--text-muted)', fontWeight: 500 }}>
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={i} style={{ backgroundColor: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.02)' }}>
                  {cols.map(c => (
                    <td key={c} style={{ padding: '5px 10px', borderBottom: '1px solid rgba(255,255,255,0.05)', color: 'var(--text)' }}>
                      {row[c] == null ? '—' : String(row[c])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  // ── Render ────────────────────────────────────────────────────────
  return (
    <div style={{ maxWidth: 900, margin: '0 auto', padding: 16 }}>

      {/* Info banner */}
      <div style={{ background: 'rgba(56,189,248,0.08)', border: '1px solid rgba(56,189,248,0.2)', borderRadius: 6, padding: '14px 18px', marginBottom: 20 }}>
        <div style={{ fontWeight: 600, marginBottom: 6, color: 'var(--accent)' }}>💳 Reconcile Member Payments</div>
        <div style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.6 }}>
          Finds members who have a qualifying membership payment on file but whose <strong>Status</strong> or <strong>Expiration</strong> is out of sync.
          <br />Using config: <strong>MembershipCollectionStart</strong> = {config.start} &nbsp;|&nbsp; <strong>MembershipYearEnd</strong> = {config.yearEnd}
          <br />Lifetime members are excluded. Family members are cascaded automatically.
        </div>
      </div>

      {/* Step 1 — Dry Run */}
      <div style={{ marginBottom: 8, fontWeight: 600, color: 'var(--text)' }}>Step 1 — Preview (Dry Run)</div>
      <button
        onClick={runDryRun}
        disabled={loading}
        style={{ padding: '8px 20px', borderRadius: 4, border: 'none', background: '#0ea5e9', color: '#fff', fontWeight: 600, cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.6 : 1 }}
      >
        {loading && !execRows ? '⏳ Running…' : '🔍 Preview Changes (Dry Run)'}
      </button>

      {error && (
        <div style={{ marginTop: 12, padding: '10px 14px', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 4, color: '#f87171' }}>
          ⚠ {error}
        </div>
      )}

      {dryRows !== null && (
        <>
          <ResultTable rows={dryRows} title="Preview" accent="#fb923c" />

          {dryRows.length > 0 && (
            <div style={{ marginTop: 20 }}>
              {/* Step 2 — Confirm + Execute */}
              <div style={{ fontWeight: 600, color: 'var(--text)', marginBottom: 8 }}>Step 2 — Execute</div>

              {execRows === null && (
                <>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--text-muted)', marginBottom: 12, cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={confirmed}
                      onChange={e => setConfirmed(e.target.checked)}
                    />
                    I have reviewed the preview above and want to update {dryRows.length} member(s).
                  </label>

                  <button
                    onClick={runExecute}
                    disabled={!confirmed || loading}
                    style={{
                      padding: '8px 20px', borderRadius: 4, border: 'none',
                      background: confirmed ? '#22c55e' : '#374151',
                      color: confirmed ? '#fff' : '#6b7280',
                      fontWeight: 600,
                      cursor: !confirmed || loading ? 'not-allowed' : 'pointer',
                    }}
                  >
                    {loading ? '⏳ Applying…' : '✅ Apply Reconciliation'}
                  </button>
                </>
              )}

              {execRows !== null && (
                <ResultTable rows={execRows} title="Execution Result" accent="#22c55e" />
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
};
