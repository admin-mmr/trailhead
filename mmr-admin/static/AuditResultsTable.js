/**
 * Audit Results Table Component
 * Large expandable results table for audit entries with unmatch functionality
 */

const AuditResultsTable = ({
  auditResults,
  expandedRows,
  onToggleRow,
  onUnmatch,
  unmatching,
  startDate,
  endDate,
  targetExpiration,
  showNotTracedOnly,
  membershipFilter,
}) => {
  const inferMembershipType = (entry) => {
    if (entry.membership_type) return entry.membership_type;
    const amount = parseFloat(entry.amount);
    if (amount === 50) return 'Family';
    if (amount === 30) return 'Individual';
    return null;
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

  const expirationColor = (dateStr) => {
    if (!dateStr) return '#94a3b8';
    const exp = new Date(dateStr);
    const now = new Date();
    const days = (exp - now) / (1000 * 60 * 60 * 24);
    if (days < 0) return '#f87171';
    if (days < 60) return '#fb923c';
    return '#4ade80';
  };

  const filteredResults = auditResults?.audit_results?.filter(entry => {
    const inferredType = inferMembershipType(entry);
    if (!membershipFilter.has(inferredType)) return false;
    if (showNotTracedOnly && entry.trace_route !== 'NOT TRACED') return false;
    return true;
  }) || [];

  return (
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
                    onClick={() => onToggleRow(entry.transaction_id)}>
                  <td style={{ padding: '10px', textAlign: 'center', color: 'var(--text2)' }}>
                    <button
                      onClick={e => { e.stopPropagation(); onToggleRow(entry.transaction_id); }}
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
                              onClick={(e) => { e.stopPropagation(); onUnmatch(entry.transaction_id); }}
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
  );
};

window.AuditResultsTable = AuditResultsTable;
