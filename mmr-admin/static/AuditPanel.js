/**
 * Membership Renewal Audit Panel
 *
 * Allows admins to:
 * 1. Specify date range and target expiration
 * 2. Run audit to find and trace membership transactions
 * 3. Verify expiration dates match target
 * 4. Check family member consistency
 * 5. Export audit results
 * 6. Member lookup by partial name
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

  // Member search state
  const [memberSearch, setMemberSearch] = React.useState('');
  const [memberSearchResults, setMemberSearchResults] = React.useState([]);
  const [memberSearchLoading, setMemberSearchLoading] = React.useState(false);
  const memberSearchTimer = React.useRef(null);

  // ── Config load ──────────────────────────────────────────────────
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

  // ── Debounced member search ──────────────────────────────────────
  React.useEffect(() => {
    if (memberSearchTimer.current) clearTimeout(memberSearchTimer.current);
    if (!memberSearch.trim()) {
      setMemberSearchResults([]);
      return;
    }
    memberSearchTimer.current = setTimeout(async () => {
      setMemberSearchLoading(true);
      try {
        const resp = await mmrUtils.api(`/api/members/search?q=${encodeURIComponent(memberSearch.trim())}`);
        setMemberSearchResults(resp.ok ? resp.data : []);
      } catch {
        setMemberSearchResults([]);
      } finally {
        setMemberSearchLoading(false);
      }
    }, 300);
  }, [memberSearch]);

  // ── Audit run ────────────────────────────────────────────────────
  const runAudit = async () => {
    setLoading(true);
    setError('');
    setAuditResults(null);
    try {
      const response = await mmrUtils.api('/api/audit/renewal', {
        method: 'POST',
        body: JSON.stringify({ start_date: startDate, end_date: endDate, target_expiration: targetExpiration })
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

  const inferMembershipType = (entry) => {
    if (entry.membership_type) return entry.membership_type;
    const amount = parseFloat(entry.amount);
    if (amount === 50) return 'Family';
    if (amount === 30) return 'Individual';
    return null;
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

  const getStatusColor = (status) => {
    if (!status) return '#94a3b8';
    if (status.includes('MATCH')) return '#4ade80';
    if (status.includes('MISMATCH') || status.includes('NO EXPIRATION')) return '#f87171';
    if (status.includes('NOT TRACED')) return '#fb923c';
    return '#94a3b8';
  };

  const getStatusIcon = (status) => {
    if (!status) return '❓';
    if (status.includes('MATCH')) return '✓';
    if (status.includes('MISMATCH') || status.includes('NO EXPIRATION')) return '✗';
    if (status.includes('NOT TRACED')) return '⚠';
    return '?';
  };

  // ── Expiration badge color ────────────────────────────────────────
  const expirationColor = (dateStr) => {
    if (!dateStr) return '#94a3b8';
    const exp = new Date(dateStr);
    const now = new Date();
    const days = (exp - now) / (1000 * 60 * 60 * 24);
    if (days < 0) return '#f87171';   // expired
    if (days < 60) return '#fb923c';  // expiring soon
    return '#4ade80';                 // good
  };

  // ── Shared inline style tokens (dark theme) ───────────────────────
  const s = {
    inputBase: { width: '100%', padding: '8px', border: '1px solid var(--border)', borderRadius: '4px', fontSize: '14px', backgroundColor: 'var(--surface2)', color: 'var(--text)' },
    label: { display: 'block', marginBottom: '6px', fontWeight: '500', color: 'var(--text2)', fontSize: '13px' },
    card: { backgroundColor: 'var(--surface)', padding: '12px', borderRadius: '6px', border: '1px solid var(--border)' },
  };

  return (
    <div style={{ padding: '20px', fontFamily: 'system-ui, -apple-system, sans-serif', backgroundColor: 'var(--bg)', minHeight: '100vh', color: 'var(--text)' }}>
      <h2 style={{ marginBottom: '20px', color: 'var(--text)', fontSize: '18px' }}>🔍 Membership Renewal Audit</h2>

      {/* ── Member Lookup Card ────────────────────────────────────── */}
      <div style={{ ...s.card, marginBottom: '20px' }}>
        <div style={{ fontSize: '13px', fontWeight: '600', color: 'var(--text2)', marginBottom: '10px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
          🔎 Member Lookup
        </div>
        <input
          type="text"
          placeholder="Search by name, email, or member ID…"
          value={memberSearch}
          onChange={e => setMemberSearch(e.target.value)}
          style={{ ...s.inputBase, marginBottom: '10px' }}
        />
        {memberSearchLoading && (
          <div style={{ color: 'var(--text2)', fontSize: '13px' }}>Searching…</div>
        )}
        {!memberSearchLoading && memberSearch && memberSearchResults.length === 0 && (
          <div style={{ color: 'var(--text2)', fontSize: '13px' }}>No members found.</div>
        )}
        {memberSearchResults.length > 0 && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '8px' }}>
            {memberSearchResults.map(m => (
              <div key={m.MemberID} style={{
                backgroundColor: 'var(--surface2)',
                borderRadius: '6px',
                padding: '10px 12px',
                border: `1px solid var(--border)`,
                display: 'flex',
                flexDirection: 'column',
                gap: '4px'
              }}>
                <div style={{ fontWeight: '600', fontSize: '14px', color: 'var(--text)' }}>
                  {m.FirstName} {m.LastName}
                </div>
                <div style={{ fontSize: '12px', color: 'var(--text2)' }}>
                  {m.MemberID} · {m.Type || '—'}
                  {m.FamilyID && <span style={{ marginLeft: '6px', color: 'var(--accent)' }}>Family</span>}
                </div>
                <div style={{ fontSize: '12px', color: 'var(--text2)' }}>{m.Email || ''}</div>
                <div style={{ marginTop: '4px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span style={{ fontSize: '11px', color: 'var(--text2)' }}>Expires:</span>
                  <span style={{
                    fontSize: '12px',
                    fontWeight: '600',
                    color: expirationColor(m.Expiration),
                    backgroundColor: 'rgba(0,0,0,0.2)',
                    padding: '1px 7px',
                    borderRadius: '4px'
                  }}>
                    {m.Expiration || 'Not set'}
                  </span>
                  {m.Status && (
                    <span style={{ fontSize: '11px', color: 'var(--text2)', marginLeft: '4px' }}>{m.Status}</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

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

      {/* ── Summary ───────────────────────────────────────────────── */}
      {auditResults?.summary && (
        <div style={{ backgroundColor: 'rgba(56,189,248,0.08)', border: '1px solid rgba(56,189,248,0.25)', borderRadius: '6px', padding: '16px', marginBottom: '20px' }}>
          <h3 style={{ margin: '0 0 12px 0', fontSize: '14px', color: 'var(--text2)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>📊 Audit Summary</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '10px' }}>
            {[
              { label: 'Total Transactions', value: auditResults.summary.total_transactions || 0, color: 'var(--text)' },
              { label: 'Traced Members',     value: auditResults.summary.traced_members || 0,     color: 'var(--accent)' },
              { label: '✓ Matched',          value: auditResults.summary.expirations_matched || 0, color: '#4ade80' },
              { label: '✗ Mismatched',       value: auditResults.summary.expirations_mismatched || 0, color: '#f87171' },
              { label: '⚠ Not Traced',       value: auditResults.summary.not_traced || 0,          color: '#fb923c' },
            ].map(({ label, value, color }) => (
              <div key={label} style={{ ...s.card, textAlign: 'center' }}>
                <div style={{ fontSize: '11px', color: 'var(--text2)', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.4px' }}>{label}</div>
                <div style={{ fontSize: '26px', fontWeight: 'bold', color }}>{value}</div>
              </div>
            ))}
          </div>
          {showNotTracedOnly && filteredResults.length > 0 && (
            <div style={{ marginTop: '10px', fontSize: '12px', color: '#fb923c' }}>
              Showing {filteredResults.length} Not Traced transaction{filteredResults.length !== 1 ? 's' : ''}
            </div>
          )}
        </div>
      )}

      {/* ── Results Table ─────────────────────────────────────────── */}
      {auditResults && filteredResults.length > 0 && (
        <div style={{ overflowX: 'auto', border: '1px solid var(--border)', borderRadius: '6px' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px', backgroundColor: 'var(--bg)' }}>
            <thead>
              <tr style={{ backgroundColor: 'var(--surface2)', borderBottom: '2px solid var(--border)' }}>
                <th style={{ padding: '10px', textAlign: 'left', fontWeight: '600', minWidth: '50px', color: 'var(--text2)', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>▼</th>
                <th style={{ padding: '10px', textAlign: 'left', fontWeight: '600', color: 'var(--text2)', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Transaction</th>
                <th style={{ padding: '10px', textAlign: 'left', fontWeight: '600', color: 'var(--text2)', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Member</th>
                <th style={{ padding: '10px', textAlign: 'center', fontWeight: '600', minWidth: '100px', color: 'var(--text2)', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Status</th>
                <th style={{ padding: '10px', textAlign: 'left', fontWeight: '600', color: 'var(--text2)', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Trace Route</th>
                <th style={{ padding: '10px', textAlign: 'center', fontWeight: '600', minWidth: '80px', color: 'var(--text2)', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Flags</th>
              </tr>
            </thead>
            <tbody>
              {filteredResults.map((entry, idx) => {
                const isExpanded = expandedRows.has(entry.transaction_id);
                const rowBg = isExpanded ? 'var(--surface)' : (idx % 2 === 0 ? 'var(--bg)' : 'var(--surface)');
                return (
                  <React.Fragment key={idx}>
                    <tr style={{ borderBottom: '1px solid var(--border)', backgroundColor: rowBg, cursor: 'pointer' }}
                        onClick={() => toggleRowExpand(entry.transaction_id)}>
                      <td style={{ padding: '10px', textAlign: 'center', color: 'var(--text2)' }}>
                        <button
                          onClick={e => { e.stopPropagation(); toggleRowExpand(entry.transaction_id); }}
                          style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '14px', padding: '0', width: '30px', color: 'var(--text2)' }}
                        >
                          {isExpanded ? '▼' : '▶'}
                        </button>
                      </td>
                      <td style={{ padding: '10px', color: 'var(--text)' }}>
                        <div style={{ fontWeight: '600', marginBottom: '4px', fontFamily: 'monospace', fontSize: '12px', color: 'var(--accent)' }}>
                          {entry.transaction_id.substring(0, 16)}…
                        </div>
                        <div style={{ color: 'var(--text)', fontSize: '12px', marginBottom: '4px' }}>
                          ${entry.amount?.toFixed(2) || 'N/A'} · {entry.transaction_date}
                        </div>
                        <div style={{ color: 'var(--text2)', fontSize: '11px', marginBottom: '2px', wordBreak: 'break-word' }}>
                          <strong style={{ color: 'var(--text)' }}>From:</strong> {entry.sender || '—'}
                        </div>
                        <div style={{ color: 'var(--text2)', fontSize: '11px', wordBreak: 'break-word' }}>
                          <strong style={{ color: 'var(--text)' }}>Memo:</strong> {entry.memo || '—'}
                        </div>
                      </td>
                      <td style={{ padding: '10px', color: 'var(--text)' }}>
                        <div style={{ fontWeight: '600' }}>{entry.member_name || '—'}</div>
                        <div style={{ color: 'var(--text2)', fontSize: '12px' }}>
                          {entry.member_id || '—'} · {inferMembershipType(entry) || '—'}
                        </div>
                      </td>
                      <td style={{ padding: '10px', textAlign: 'center' }}>
                        <div style={{
                          display: 'inline-block',
                          padding: '4px 10px',
                          borderRadius: '4px',
                          backgroundColor: `${getStatusColor(entry.match_status)}22`,
                          color: getStatusColor(entry.match_status),
                          border: `1px solid ${getStatusColor(entry.match_status)}55`,
                          fontWeight: '700',
                          fontSize: '13px'
                        }}>
                          {getStatusIcon(entry.match_status)}
                        </div>
                      </td>
                      <td style={{ padding: '10px', fontSize: '12px', color: 'var(--text2)' }}>
                        {entry.trace_route === 'NOT TRACED' ? <span style={{ color: '#fb923c' }}>— not traced</span> : entry.trace_route}
                      </td>
                      <td style={{ padding: '10px', textAlign: 'center' }}>
                        {entry.red_flags?.length > 0 ? (
                          <span style={{ color: '#f87171', fontWeight: '700', fontSize: '13px' }}>
                            {entry.red_flags.length}
                          </span>
                        ) : (
                          <span style={{ color: 'var(--border)', fontSize: '12px' }}>—</span>
                        )}
                      </td>
                    </tr>

                    {/* ── Expanded Detail ────────────────────────── */}
                    {isExpanded && (
                      <tr style={{ backgroundColor: 'var(--surface)', borderBottom: `2px solid var(--border)` }}>
                        <td colSpan="6" style={{ padding: '0' }}>
                          <div style={{
                            borderLeft: `4px solid ${getStatusColor(entry.match_status)}`,
                            padding: '16px 20px 16px 20px',
                            display: 'grid',
                            gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
                            gap: '16px'
                          }}>
                            <div>
                              <div style={{ fontSize: '11px', color: 'var(--text2)', marginBottom: '4px', fontWeight: '600', textTransform: 'uppercase', letterSpacing: '0.4px' }}>
                                Expiration Date
                              </div>
                              <div style={{ fontSize: '14px', color: expirationColor(entry.expiration_date), fontWeight: '600' }}>
                                {entry.expiration_date || <span style={{ color: 'var(--text2)' }}>Not set</span>}
                              </div>
                            </div>

                            <div>
                              <div style={{ fontSize: '11px', color: 'var(--text2)', marginBottom: '4px', fontWeight: '600', textTransform: 'uppercase', letterSpacing: '0.4px' }}>
                                Target Expiration
                              </div>
                              <div style={{ fontSize: '14px', color: 'var(--text)' }}>{entry.target_expiration}</div>
                            </div>

                            <div>
                              <div style={{ fontSize: '11px', color: 'var(--text2)', marginBottom: '4px', fontWeight: '600', textTransform: 'uppercase', letterSpacing: '0.4px' }}>
                                Match Status
                              </div>
                              <div style={{ fontSize: '14px', fontWeight: '700', color: getStatusColor(entry.match_status) }}>
                                {entry.match_status?.includes('NOT TRACED') && '⚠ '}
                                {entry.match_status?.includes('MATCH') && !entry.match_status?.includes('MIS') && '✓ '}
                                {entry.match_status?.includes('MISMATCH') && '✗ '}
                                {entry.match_status}
                              </div>
                            </div>

                            {entry.red_flags?.length > 0 && (
                              <div style={{ gridColumn: '1 / -1' }}>
                                <div style={{ fontSize: '11px', color: 'var(--text2)', marginBottom: '8px', fontWeight: '600', textTransform: 'uppercase', letterSpacing: '0.4px' }}>
                                  Red Flags
                                </div>
                                <ul style={{ margin: '0', paddingLeft: '18px' }}>
                                  {entry.red_flags.map((flag, i) => (
                                    <li key={i} style={{ color: '#f87171', marginBottom: '4px', fontSize: '13px' }}>{flag}</li>
                                  ))}
                                </ul>
                              </div>
                            )}

                            {entry.trace_route === 'NOT TRACED' && (
                              <div style={{ gridColumn: '1 / -1', display: 'flex', alignItems: 'flex-start', flexDirection: 'column', gap: '6px' }}>
                                <button
                                  onClick={(e) => { e.stopPropagation(); unmatchTransaction(entry.transaction_id); }}
                                  disabled={unmatching === entry.transaction_id}
                                  style={{
                                    padding: '8px 16px',
                                    backgroundColor: unmatching === entry.transaction_id ? 'var(--surface2)' : '#d73a49',
                                    color: unmatching === entry.transaction_id ? 'var(--text2)' : 'white',
                                    border: 'none',
                                    borderRadius: '4px',
                                    cursor: unmatching === entry.transaction_id ? 'not-allowed' : 'pointer',
                                    fontSize: '13px',
                                    fontWeight: '600'
                                  }}
                                >
                                  {unmatching === entry.transaction_id ? '⏳ Unmatching…' : '🔌 Unmatch Transaction'}
                                </button>
                                <div style={{ fontSize: '11px', color: 'var(--text2)' }}>
                                  Resets ProcessedTime &amp; PaymentID in gmail_transactions
                                </div>
                              </div>
                            )}

                            {entry.family_check && (
                              <div style={{ gridColumn: '1 / -1' }}>
                                <div style={{ fontSize: '11px', color: 'var(--text2)', marginBottom: '8px', fontWeight: '600', textTransform: 'uppercase', letterSpacing: '0.4px' }}>
                                  Family Member Check
                                </div>
                                <div style={{
                                  padding: '10px',
                                  borderRadius: '4px',
                                  backgroundColor: entry.family_check.all_consistent ? 'rgba(74,222,128,0.1)' : 'rgba(248,113,113,0.1)',
                                  border: `1px solid ${entry.family_check.all_consistent ? 'rgba(74,222,128,0.3)' : 'rgba(248,113,113,0.3)'}`,
                                  marginBottom: '8px'
                                }}>
                                  <div style={{ fontWeight: '600', marginBottom: '8px', color: entry.family_check.all_consistent ? '#4ade80' : '#f87171' }}>
                                    {entry.family_check.all_consistent ? '✓ All consistent' : '✗ Inconsistencies found'}
                                  </div>
                                  {entry.family_check.family_members?.map((member, i) => {
                                    const isInconsistent = entry.family_check.inconsistent?.some(m => m.member_id === member.member_id);
                                    return (
                                      <div key={i} style={{ fontSize: '12px', padding: '3px 0', color: isInconsistent ? '#f87171' : 'var(--text2)' }}>
                                        {member.member_id} · {member.name} · {member.expiration || 'No expiration'}
                                        {isInconsistent && ' ⚠'}
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

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
