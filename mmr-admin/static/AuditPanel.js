/**
 * Membership Renewal Audit Panel
 *
 * Allows admins to:
 * 1. Specify date range and target expiration
 * 2. Run audit to find and trace membership transactions
 * 3. Verify expiration dates match target
 * 4. Check family member consistency
 * 5. Export audit results
 */

window.AuditPanel = () => {
  const [startDate, setStartDate] = React.useState('');
  const [endDate, setEndDate] = React.useState('');
  const [targetExpiration, setTargetExpiration] = React.useState('');
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState('');
  const [auditResults, setAuditResults] = React.useState(null);
  const [expandedRows, setExpandedRows] = React.useState(new Set());

  // Get default dates and membership year end from config
  React.useEffect(() => {
    const today = new Date();

    // Default start date: 10/01/2025
    setStartDate('2025-10-01');

    // Default end date: today
    setEndDate(today.toISOString().split('T')[0]);

    // Load MembershipYearEnd from config via API
    const loadConfig = async () => {
      try {
        console.log('Loading MembershipYearEnd from config...');
        const response = await fetch('/api/config/get?key=MembershipYearEnd');
        const data = await response.json();

        console.log('Config response:', data);

        if (data.success && data.value) {
          // Format is MM-DD, e.g., "12-31"
          console.log('Config value:', data.value);
          const parts = String(data.value).split('-');
          const [month, day] = parts;

          if (month && day) {
            const targetDate = `${today.getFullYear()}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
            console.log('Calculated target expiration:', targetDate);
            setTargetExpiration(targetDate);
          } else {
            console.log('Invalid config format, using fallback');
            setTargetExpiration(`${today.getFullYear()}-12-31`);
          }
        } else {
          console.log('No config value returned, using fallback');
          setTargetExpiration(`${today.getFullYear()}-12-31`);
        }
      } catch (err) {
        console.error('Error loading config:', err);
        // Fallback: use 12-31 of current year
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
      const payload = {
        start_date: startDate,
        end_date: endDate,
        target_expiration: targetExpiration
      };

      console.log('Sending audit request with payload:', payload);

      const response = await mmrUtils.api('/api/audit/renewal', {
        method: 'POST',
        body: JSON.stringify(payload)
      });

      console.log('Audit response:', response);

      if (!response.success) {
        const errorMsg = response.error || 'Audit failed';
        console.error('Audit error:', errorMsg);
        setError(errorMsg);
        return;
      }

      console.log(`Audit complete: ${response.summary.total_transactions} transactions found`);
      setAuditResults(response);
    } catch (err) {
      const errorMsg = `Error: ${err.message}`;
      console.error('Audit exception:', err);
      setError(errorMsg);
    } finally {
      setLoading(false);
    }
  };

  const toggleRowExpand = (txnId) => {
    const newExpanded = new Set(expandedRows);
    if (newExpanded.has(txnId)) {
      newExpanded.delete(txnId);
    } else {
      newExpanded.add(txnId);
    }
    setExpandedRows(newExpanded);
  };

  const exportResults = () => {
    if (!auditResults || !auditResults.audit_results) return;

    const rows = auditResults.audit_results;
    const headers = [
      'Transaction ID',
      'Amount',
      'Transaction Date',
      'Member ID',
      'Member Name',
      'Type',
      'Expiration Date',
      'Target Expiration',
      'Match Status',
      'Trace Route',
      'Red Flags'
    ];

    const csv = [
      headers.join(','),
      ...rows.map(row => [
        row.transaction_id,
        row.amount,
        row.transaction_date,
        row.member_id || '',
        row.member_name || '',
        row.membership_type || '',
        row.expiration_date || '',
        row.target_expiration,
        row.match_status || '',
        row.trace_route || '',
        (row.red_flags && row.red_flags.length > 0 ? row.red_flags.join('; ') : '')
      ].map(field => `"${String(field || '').replace(/"/g, '""')}"`).join(','))
    ].join('\n');

    const blob = new Blob([csv], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `audit_renewal_${startDate}_${endDate}.csv`;
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    document.body.removeChild(a);
  };

  const getStatusColor = (status) => {
    if (!status) return '#999';
    if (status.includes('MATCH')) return '#28a745';
    if (status.includes('MISMATCH') || status.includes('NO EXPIRATION')) return '#dc3545';
    if (status.includes('NOT TRACED')) return '#ffc107';
    return '#6c757d';
  };

  const getStatusIcon = (status) => {
    if (!status) return '❓';
    if (status.includes('MATCH')) return '✓';
    if (status.includes('MISMATCH') || status.includes('NO EXPIRATION')) return '✗';
    if (status.includes('NOT TRACED')) return '⚠';
    return '?';
  };

  return (
    <div style={{ padding: '20px', fontFamily: 'system-ui, -apple-system, sans-serif' }}>
      <h2 style={{ marginBottom: '20px' }}>🔍 Membership Renewal Audit</h2>

      {/* Input Section */}
      <div style={{
        backgroundColor: '#f8f9fa',
        border: '1px solid #dee2e6',
        borderRadius: '6px',
        padding: '16px',
        marginBottom: '20px'
      }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '16px', marginBottom: '16px' }}>
          <div>
            <label style={{ display: 'block', marginBottom: '6px', fontWeight: '500' }}>
              Transaction Start Date
            </label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              disabled={loading}
              style={{
                width: '100%',
                padding: '8px',
                border: '1px solid #dee2e6',
                borderRadius: '4px',
                fontSize: '14px'
              }}
            />
          </div>

          <div>
            <label style={{ display: 'block', marginBottom: '6px', fontWeight: '500' }}>
              Transaction End Date
            </label>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              disabled={loading}
              style={{
                width: '100%',
                padding: '8px',
                border: '1px solid #dee2e6',
                borderRadius: '4px',
                fontSize: '14px'
              }}
            />
          </div>

          <div>
            <label style={{ display: 'block', marginBottom: '6px', fontWeight: '500' }}>
              Target Expiration Date
            </label>
            <input
              type="date"
              value={targetExpiration}
              onChange={(e) => setTargetExpiration(e.target.value)}
              disabled={loading}
              style={{
                width: '100%',
                padding: '8px',
                border: '1px solid #dee2e6',
                borderRadius: '4px',
                fontSize: '14px'
              }}
            />
          </div>
        </div>

        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            onClick={runAudit}
            disabled={loading || !startDate || !endDate || !targetExpiration}
            style={{
              padding: '8px 16px',
              backgroundColor: loading ? '#ccc' : '#007bff',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: loading ? 'not-allowed' : 'pointer',
              fontSize: '14px',
              fontWeight: '500'
            }}
          >
            {loading ? '⏳ Running Audit...' : '▶ Run Audit'}
          </button>

          {auditResults && (
            <button
              onClick={exportResults}
              style={{
                padding: '8px 16px',
                backgroundColor: '#28a745',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer',
                fontSize: '14px',
                fontWeight: '500'
              }}
            >
              📥 Export CSV
            </button>
          )}
        </div>
      </div>

      {/* Error Message */}
      {error && (
        <div style={{
          backgroundColor: '#f8d7da',
          border: '1px solid #f5c6cb',
          borderRadius: '4px',
          padding: '12px',
          marginBottom: '20px',
          color: '#721c24'
        }}>
          {error}
        </div>
      )}

      {/* Summary */}
      {auditResults && auditResults.summary && (
        <div style={{
          backgroundColor: '#e7f3ff',
          border: '1px solid #b3d9ff',
          borderRadius: '6px',
          padding: '16px',
          marginBottom: '20px'
        }}>
          <h3 style={{ margin: '0 0 12px 0', fontSize: '16px' }}>Audit Summary</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px' }}>
            <div>
              <div style={{ fontSize: '12px', color: '#666', marginBottom: '4px' }}>Total Transactions</div>
              <div style={{ fontSize: '20px', fontWeight: 'bold', color: '#0066cc' }}>
                {auditResults.summary.total_transactions || 0}
              </div>
            </div>
            <div>
              <div style={{ fontSize: '12px', color: '#666', marginBottom: '4px' }}>Traced Members</div>
              <div style={{ fontSize: '20px', fontWeight: 'bold', color: '#0066cc' }}>
                {auditResults.summary.traced_members || 0}
              </div>
            </div>
            <div>
              <div style={{ fontSize: '12px', color: '#666', marginBottom: '4px' }}>✓ Expirations Matched</div>
              <div style={{ fontSize: '20px', fontWeight: 'bold', color: '#28a745' }}>
                {auditResults.summary.expirations_matched || 0}
              </div>
            </div>
            <div>
              <div style={{ fontSize: '12px', color: '#666', marginBottom: '4px' }}>✗ Expirations Mismatched</div>
              <div style={{ fontSize: '20px', fontWeight: 'bold', color: '#dc3545' }}>
                {auditResults.summary.expirations_mismatched || 0}
              </div>
            </div>
            <div>
              <div style={{ fontSize: '12px', color: '#666', marginBottom: '4px' }}>⚠ Not Traced</div>
              <div style={{ fontSize: '20px', fontWeight: 'bold', color: '#ffc107' }}>
                {auditResults.summary.not_traced || 0}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Results Table */}
      {auditResults && auditResults.audit_results && auditResults.audit_results.length > 0 && (
        <div style={{ overflowX: 'auto' }}>
          <table style={{
            width: '100%',
            borderCollapse: 'collapse',
            fontSize: '13px',
            backgroundColor: 'white'
          }}>
            <thead>
              <tr style={{ backgroundColor: '#f8f9fa', borderBottom: '2px solid #dee2e6' }}>
                <th style={{ padding: '10px', textAlign: 'left', fontWeight: '500', minWidth: '60px' }}>Expand</th>
                <th style={{ padding: '10px', textAlign: 'left', fontWeight: '500' }}>Transaction</th>
                <th style={{ padding: '10px', textAlign: 'left', fontWeight: '500' }}>Member</th>
                <th style={{ padding: '10px', textAlign: 'center', fontWeight: '500', minWidth: '100px' }}>Status</th>
                <th style={{ padding: '10px', textAlign: 'left', fontWeight: '500' }}>Trace Route</th>
                <th style={{ padding: '10px', textAlign: 'left', fontWeight: '500' }}>Red Flags</th>
              </tr>
            </thead>
            <tbody>
              {auditResults.audit_results.map((entry, idx) => {
                const isExpanded = expandedRows.has(entry.transaction_id);
                return (
                  <React.Fragment key={idx}>
                    <tr style={{
                      borderBottom: '1px solid #dee2e6',
                      backgroundColor: idx % 2 === 0 ? 'white' : '#f9f9f9',
                      ...(entry.red_flags && entry.red_flags.length > 0 ? { backgroundColor: '#fff3cd' } : {})
                    }}>
                      <td style={{ padding: '10px', textAlign: 'center' }}>
                        <button
                          onClick={() => toggleRowExpand(entry.transaction_id)}
                          style={{
                            background: 'none',
                            border: 'none',
                            cursor: 'pointer',
                            fontSize: '16px',
                            padding: '0',
                            width: '30px'
                          }}
                        >
                          {isExpanded ? '▼' : '▶'}
                        </button>
                      </td>
                      <td style={{ padding: '10px' }}>
                        <div style={{ fontWeight: '500', marginBottom: '4px' }}>
                          {entry.transaction_id.substring(0, 20)}...
                        </div>
                        <div style={{ color: '#666', fontSize: '12px' }}>
                          ${entry.amount?.toFixed(2) || 'N/A'} • {entry.transaction_date}
                        </div>
                      </td>
                      <td style={{ padding: '10px' }}>
                        <div style={{ fontWeight: '500' }}>{entry.member_name || 'N/A'}</div>
                        <div style={{ color: '#666', fontSize: '12px' }}>
                          ID: {entry.member_id || 'N/A'} • {entry.membership_type || 'N/A'}
                        </div>
                      </td>
                      <td style={{ padding: '10px', textAlign: 'center' }}>
                        <div style={{
                          display: 'inline-block',
                          padding: '4px 8px',
                          borderRadius: '4px',
                          backgroundColor: getStatusColor(entry.match_status),
                          color: 'white',
                          fontWeight: '500',
                          fontSize: '12px'
                        }}>
                          {getStatusIcon(entry.match_status)} {entry.match_status}
                        </div>
                      </td>
                      <td style={{ padding: '10px' }}>
                        <div style={{ fontSize: '12px', color: '#666' }}>
                          {entry.trace_route || 'Not traced'}
                        </div>
                      </td>
                      <td style={{ padding: '10px' }}>
                        {entry.red_flags && entry.red_flags.length > 0 ? (
                          <div style={{ color: '#dc3545', fontWeight: '500', fontSize: '12px' }}>
                            ⚠ {entry.red_flags.length} flag(s)
                          </div>
                        ) : (
                          <div style={{ color: '#666', fontSize: '12px' }}>—</div>
                        )}
                      </td>
                    </tr>

                    {/* Expanded Details */}
                    {isExpanded && (
                      <tr style={{ backgroundColor: '#f0f0f0', borderBottom: '1px solid #dee2e6' }}>
                        <td colSpan="6" style={{ padding: '16px', paddingLeft: '40px' }}>
                          <div style={{
                            display: 'grid',
                            gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))',
                            gap: '16px'
                          }}>
                            <div>
                              <div style={{ fontSize: '12px', color: '#666', marginBottom: '4px', fontWeight: '500' }}>
                                Expiration Date
                              </div>
                              <div style={{ fontSize: '14px' }}>
                                {entry.expiration_date || 'Not set'}
                              </div>
                            </div>

                            <div>
                              <div style={{ fontSize: '12px', color: '#666', marginBottom: '4px', fontWeight: '500' }}>
                                Target Expiration
                              </div>
                              <div style={{ fontSize: '14px' }}>
                                {entry.target_expiration}
                              </div>
                            </div>

                            <div>
                              <div style={{ fontSize: '12px', color: '#666', marginBottom: '4px', fontWeight: '500' }}>
                                Match Status
                              </div>
                              <div style={{ fontSize: '14px', fontWeight: '500', color: getStatusColor(entry.match_status) }}>
                                {entry.match_status}
                              </div>
                            </div>

                            {entry.red_flags && entry.red_flags.length > 0 && (
                              <div style={{ gridColumn: '1 / -1' }}>
                                <div style={{ fontSize: '12px', color: '#666', marginBottom: '8px', fontWeight: '500' }}>
                                  Red Flags
                                </div>
                                <ul style={{ margin: '0', paddingLeft: '20px' }}>
                                  {entry.red_flags.map((flag, i) => (
                                    <li key={i} style={{ color: '#dc3545', marginBottom: '4px' }}>
                                      {flag}
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            )}

                            {entry.family_check && (
                              <div style={{ gridColumn: '1 / -1' }}>
                                <div style={{ fontSize: '12px', color: '#666', marginBottom: '8px', fontWeight: '500' }}>
                                  Family Member Check
                                </div>
                                <div style={{
                                  padding: '8px',
                                  borderRadius: '4px',
                                  backgroundColor: entry.family_check.all_consistent ? '#d4edda' : '#f8d7da',
                                  marginBottom: '8px'
                                }}>
                                  <div style={{ fontWeight: '500', marginBottom: '8px' }}>
                                    {entry.family_check.all_consistent ? '✓ All consistent' : '✗ Inconsistencies found'}
                                  </div>
                                  {entry.family_check.family_members && entry.family_check.family_members.map((member, i) => (
                                    <div key={i} style={{
                                      fontSize: '12px',
                                      padding: '4px 0',
                                      color: entry.family_check.inconsistent?.some(m => m.member_id === member.member_id) ? '#dc3545' : '#333'
                                    }}>
                                      {member.member_id} • {member.name} • {member.expiration || 'No expiration'}
                                      {entry.family_check.inconsistent?.some(m => m.member_id === member.member_id) && ' ⚠'}
                                    </div>
                                  ))}
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

      {auditResults && auditResults.audit_results && auditResults.audit_results.length === 0 && (
        <div style={{
          backgroundColor: '#d1ecf1',
          border: '1px solid #bee5eb',
          borderRadius: '4px',
          padding: '16px',
          textAlign: 'center',
          color: '#0c5460'
        }}>
          No transactions found matching the specified criteria.
        </div>
      )}
    </div>
  );
};
