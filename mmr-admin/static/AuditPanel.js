/**
 * Membership Renewal Audit Panel (Core)
 * State management and audit orchestration
 * Sub-components: AuditSummaryBar, AuditResultsTable, AuditMemberLookup
 */

window.AuditPanel = () => {
  const [startDate, setStartDate] = React.useState('');
  const [endDate, setEndDate] = React.useState('');
  const [targetExpiration, setTargetExpiration] = React.useState('');
  const [membershipFilter, setMembershipFilter] = React.useState(new Set(['Individual', 'Family']));
  const [showNotTracedOnly, setShowNotTracedOnly] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [unmatching, setUnmatching] = React.useState(null);
  const [error, setError] = React.useState('');
  const [auditResults, setAuditResults] = React.useState(null);
  const [expandedRows, setExpandedRows] = React.useState(new Set());

  React.useEffect(() => {
    const today = new Date();
    setStartDate('2025-10-01');
    setEndDate(today.toISOString().split('T')[0]);

    const loadConfig = async () => {
      try {
        const response = await fetch('/api/config/get?key=MembershipYearEnd');
        const data = await response.json();
        if (data.success && data.value) {
          const valueStr = String(data.value).trim();
          if (valueStr.match(/^\d{4}-\d{2}-\d{2}$/)) {
            setTargetExpiration(valueStr);
          } else if (valueStr.match(/^\d{1,2}-\d{1,2}$/)) {
            const [month, day] = valueStr.split('-');
            setTargetExpiration(`${today.getFullYear()}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`);
          } else {
            setTargetExpiration(`${today.getFullYear()}-12-31`);
          }
        } else {
          setTargetExpiration(`${today.getFullYear()}-12-31`);
        }
      } catch (err) {
        setTargetExpiration(`${today.getFullYear()}-12-31`);
      }
    };
    loadConfig();
  }, []);

  const runAudit = async () => {
    setLoading(true);
    setError('');
    setAuditResults(null);
    try {
      const response = await mmrUtils.api('/api/audit/renewal', {
        method: 'POST',
        body: JSON.stringify({
          start_date: startDate,
          end_date: endDate,
          target_expiration: targetExpiration,
          only_mismatches: showNotTracedOnly,
        })
      });
      if (!response.success) { setError(response.error || 'Audit failed'); return; }
      setAuditResults(response);
    } catch (err) {
      setError(`Error: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const toggleMembershipFilter = (type) => {
    const newFilter = new Set(membershipFilter);
    if (newFilter.has(type)) newFilter.delete(type); else newFilter.add(type);
    setMembershipFilter(newFilter);
  };

  const toggleRowExpand = (txnId) => {
    const newExpanded = new Set(expandedRows);
    if (newExpanded.has(txnId)) newExpanded.delete(txnId); else newExpanded.add(txnId);
    setExpandedRows(newExpanded);
  };

  const unmatchTransaction = async (messageId) => {
    if (!confirm(`Unmatch transaction ${messageId}? This will reset ProcessedTime and PaymentID.`)) return;
    setUnmatching(messageId);
    try {
      const response = await mmrUtils.api('/api/audit/unmatch', {
        method: 'POST',
        body: JSON.stringify({ message_id: messageId })
      });
      if (response.success) {
        setAuditResults({
          ...auditResults,
          audit_results: auditResults.audit_results.filter(r => r.transaction_id !== messageId)
        });
        alert(`Unmatched: ${messageId}`);
      } else {
        alert(`Error: ${response.error}`);
      }
    } catch (err) {
      alert(`Error: ${err.message}`);
    } finally {
      setUnmatching(null);
    }
  };

  const inferMembershipType = (entry) => {
    if (entry.membership_type) return entry.membership_type;
    const amount = parseFloat(entry.amount);
    if (amount === 50) return 'Family';
    if (amount === 30) return 'Individual';
    return null;
  };

  const filteredResults = auditResults?.audit_results?.filter(entry => {
    const inferredType = inferMembershipType(entry);
    if (!membershipFilter.has(inferredType)) return false;
    if (showNotTracedOnly && entry.trace_route !== 'NOT TRACED') return false;
    return true;
  }) || [];

  const exportResults = () => {
    if (!auditResults?.audit_results) return;
    const headers = ['Transaction ID','Amount','Transaction Date','Member ID','Member Name','Type','Expiration Date','Target Expiration','Match Status','Trace Route','Red Flags'];
    const csv = [
      headers.join(','),
      ...auditResults.audit_results.map(row => [
        row.transaction_id, row.amount, row.transaction_date,
        row.member_id || '', row.member_name || '', row.membership_type || '',
        row.expiration_date || '', row.target_expiration, row.match_status || '',
        row.trace_route || '',
        (row.red_flags?.length > 0 ? row.red_flags.join('; ') : '')
      ].map(f => `"${String(f || '').replace(/"/g, '""')}"`).join(','))
    ].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `audit_renewal_${startDate}_${endDate}.csv`;
    document.body.appendChild(a); a.click();
    window.URL.revokeObjectURL(url); document.body.removeChild(a);
  };

  const s = {
    inputBase: { width: '100%', padding: '8px', border: '1px solid var(--border)', borderRadius: '4px', fontSize: '14px', backgroundColor: 'var(--surface2)', color: 'var(--text)' },
    label: { display: 'block', marginBottom: '6px', fontWeight: '500', color: 'var(--text2)', fontSize: '13px' },
    card: { backgroundColor: 'var(--surface)', padding: '12px', borderRadius: '6px', border: '1px solid var(--border)' },
  };

  return (
    <div style={{ padding: '20px', fontFamily: 'system-ui, -apple-system, sans-serif', backgroundColor: 'var(--bg)', minHeight: '100vh', color: 'var(--text)' }}>
      <h2 style={{ marginBottom: '20px', color: 'var(--text)', fontSize: '18px' }}>🔍 Membership Renewal Audit</h2>

      {/* ── Member Lookup Card (window.AuditMemberLookup) ─────────────── */}
      {window.AuditMemberLookup && React.createElement(window.AuditMemberLookup)}

      {/* ── Audit Controls ────────────────────────────────────────── */}
      <div style={{ ...s.card, marginBottom: '20px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px', marginBottom: '16px' }}>
          <div>
            <label style={s.label}>Start Date</label>
            <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} disabled={loading} style={s.inputBase} />
          </div>
          <div>
            <label style={s.label}>End Date</label>
            <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} disabled={loading} style={s.inputBase} />
          </div>
          <div>
            <label style={s.label}>Target Expiration</label>
            <input type="date" value={targetExpiration} onChange={e => setTargetExpiration(e.target.value)} disabled={loading} style={s.inputBase} />
          </div>
          <div>
            <label style={s.label}>Filters</label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', paddingTop: '4px' }}>
              {['Individual', 'Family'].map(type => (
                <label key={type} style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.6 : 1 }}>
                  <input type="checkbox" checked={membershipFilter.has(type)} onChange={() => toggleMembershipFilter(type)} disabled={loading} />
                  <span style={{ fontSize: '13px', color: 'var(--text)' }}>{type}</span>
                </label>
              ))}
              <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.6 : 1 }}>
                <input
                  type="checkbox"
                  checked={showNotTracedOnly}
                  onChange={() => setShowNotTracedOnly(!showNotTracedOnly)}
                  disabled={loading}
                />
                <span style={{ fontSize: '13px', color: showNotTracedOnly ? '#fb923c' : 'var(--text)' }}>
                  ⚠ Not Traced only
                </span>
              </label>
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            onClick={runAudit}
            disabled={loading || !startDate || !endDate || !targetExpiration}
            style={{ padding: '10px 20px', backgroundColor: loading ? 'var(--surface2)' : '#0056b3', color: loading ? 'var(--text2)' : 'white', border: 'none', borderRadius: '4px', cursor: loading ? 'not-allowed' : 'pointer', fontSize: '14px', fontWeight: '600' }}
          >
            {loading ? '⏳ Running…' : '▶ Run Audit'}
          </button>
          {auditResults && (
            <button
              onClick={exportResults}
              style={{ padding: '10px 20px', backgroundColor: '#007d2f', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '14px', fontWeight: '600' }}
            >
              📥 Export CSV
            </button>
          )}
        </div>
      </div>

      {/* ── Error ─────────────────────────────────────────────────── */}
      {error && (
        <div style={{ backgroundColor: 'rgba(248,113,113,0.1)', border: '1px solid #f87171', borderRadius: '4px', padding: '12px', marginBottom: '20px', color: '#f87171', fontWeight: '500' }}>
          ⚠ {error}
        </div>
      )}

      {window.AuditSummaryBar && auditResults && React.createElement(window.AuditSummaryBar, {
        auditResults,
        showNotTracedOnly,
        filteredResultsCount: filteredResults.length,
        onExport: exportResults,
      })}

      {auditResults && filteredResults.length > 0 && window.AuditResultsTable && React.createElement(window.AuditResultsTable, {
        auditResults,
        expandedRows,
        onToggleRow: toggleRowExpand,
        onUnmatch: unmatchTransaction,
        unmatching,
        startDate,
        endDate,
        targetExpiration,
        showNotTracedOnly,
        membershipFilter,
      })}

      {auditResults && filteredResults.length === 0 && auditResults.audit_results?.length > 0 && (
        <div style={{ backgroundColor: 'rgba(56,189,248,0.08)', border: '1px solid rgba(56,189,248,0.25)', borderRadius: '4px', padding: '16px', textAlign: 'center', color: 'var(--accent)', fontWeight: '500' }}>
          {showNotTracedOnly
            ? '✓ No Not Traced transactions found — all accounted for!'
            : `No ${[...membershipFilter].join(' or ')} transactions match the current filter.`}
        </div>
      )}

      {auditResults && auditResults.audit_results?.length === 0 && (
        <div style={{ backgroundColor: 'rgba(56,189,248,0.08)', border: '1px solid rgba(56,189,248,0.25)', borderRadius: '4px', padding: '16px', textAlign: 'center', color: 'var(--accent)', fontWeight: '500' }}>
          ✓ No transactions found matching the specified criteria.
        </div>
      )}
    </div>
  );
};
