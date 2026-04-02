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
  const [membershipFilter, setMembershipFilter] = React.useState(new Set(['Individual', 'Family'])); // Multi-select set
  const [loading, setLoading] = React.useState(false);
  const [unmatching, setUnmatching] = React.useState(null);
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
          console.log('Config value:', data.value);
          const valueStr = String(data.value).trim();

          // Check if it's already a full date (YYYY-MM-DD)
          if (valueStr.match(/^\d{4}-\d{2}-\d{2}$/)) {
            console.log('Config value is full date:', valueStr);
            setTargetExpiration(valueStr);
          }
          // Check if it's MM-DD format
          else if (valueStr.match(/^\d{1,2}-\d{1,2}$/)) {
            const [month, day] = valueStr.split('-');
            const targetDate = `${today.getFullYear()}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
            console.log('Calculated target expiration from MM-DD:', targetDate);
            setTargetExpiration(targetDate);
          }
          // Invalid format
          else {
            console.log('Invalid config format:', valueStr, '- using fallback');
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

  const toggleMembershipFilter = (type) => {
    const newFilter = new Set(membershipFilter);
    if (newFilter.has(type)) {
      newFilter.delete(type);
    } else {
      newFilter.add(type);
    }
    setMembershipFilter(newFilter);
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

  // Infer membership type from amount if not already set
  const inferMembershipType = (entry) => {
    if (entry.membership_type) return entry.membership_type;

    // Infer from amount: $50 → Family, $30 → Individual
    const amount = parseFloat(entry.amount);
    if (amount === 50) return 'Family';
    if (amount === 30) return 'Individual';

    return null;
  };

  const unmatchTransaction = async (messageId) => {
    if (!confirm(`Unmatch transaction ${messageId}? This will reset ProcessedTime and PaymentID.`)) {
      return;
    }

    setUnmatching(messageId);
    try {
      const response = await mmrUtils.api('/api/audit/unmatch', {
        method: 'POST',
        body: JSON.stringify({ message_id: messageId })
      });

      if (response.success) {
        // Remove the untraced item from results
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
    return membershipFilter.has(inferredType);
  }) || [];

  // Log filter status
  React.useEffect(() => {
    if (auditResults?.audit_results) {
      const types = auditResults.audit_results.map(r => r.membership_type);
      console.log(`Audit results membership types: ${JSON.stringify([...new Set(types)])}`);
      console.log(`Current filter: ${JSON.stringify([...membershipFilter])} → filtered: ${filteredResults.length} of ${auditResults.audit_results.length}`);
    }
  }, [membershipFilter, auditResults]);

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
    if (status.includes('MATCH')) return '#00b859';       // Bright green
    if (status.includes('MISMATCH') || status.includes('NO EXPIRATION')) return '#e63946';  // Bright red
    if (status.includes('NOT TRACED')) return '#ff8c00';  // Warm bright orange
    return '#666';                                         // Dark gray
  };

  const getStatusIcon = (status) => {
    if (!status) return '❓';
    if (status.includes('MATCH')) return '✓';
    if (status.includes('MISMATCH') || status.includes('NO EXPIRATION')) return '✗';
    if (status.includes('NOT TRACED')) return '⚠';
    return '?';
  };

  return (
    <div style={{ padding: '20px', fontFamily: 'system-ui, -apple-system, sans-serif', backgroundColor: '#fff', minHeight: '100vh' }}>
      <h2 style={{ marginBottom: '20px', color: '#333' }}>🔍 Membership Renewal Audit</h2>

      {/* Input Section */}
      <div style={{
        backgroundColor: '#f5f5f5',
        border: '1px solid #ccc',
        borderRadius: '6px',
        padding: '16px',
        marginBottom: '20px'
      }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px', marginBottom: '16px' }}>
          <div>
            <label style={{ display: 'block', marginBottom: '6px', fontWeight: '500', color: '#333' }}>
              Start Date
            </label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              disabled={loading}
              style={{
                width: '100%',
                padding: '8px',
                border: '1px solid #999',
                borderRadius: '4px',
                fontSize: '14px',
                color: '#333'
              }}
            />
          </div>

          <div>
            <label style={{ display: 'block', marginBottom: '6px', fontWeight: '500', color: '#333' }}>
              End Date
            </label>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              disabled={loading}
              style={{
                width: '100%',
                padding: '8px',
                border: '1px solid #999',
                borderRadius: '4px',
                fontSize: '14px',
                color: '#333'
              }}
            />
          </div>

          <div>
            <label style={{ display: 'block', marginBottom: '6px', fontWeight: '500', color: '#333' }}>
              Target Expiration
            </label>
            <input
              type="date"
              value={targetExpiration}
              onChange={(e) => setTargetExpiration(e.target.value)}
              disabled={loading}
              style={{
                width: '100%',
                padding: '8px',
                border: '1px solid #999',
                borderRadius: '4px',
                fontSize: '14px',
                color: '#333'
              }}
            />
          </div>

          <div>
            <label style={{ display: 'block', marginBottom: '6px', fontWeight: '500', color: '#333' }}>
              Membership Type
            </label>
            <div style={{ display: 'flex', gap: '16px' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.6 : 1 }}>
                <input
                  type="checkbox"
                  checked={membershipFilter.has('Individual')}
                  onChange={() => toggleMembershipFilter('Individual')}
                  disabled={loading}
                  style={{ cursor: loading ? 'not-allowed' : 'pointer' }}
                />
                <span style={{ fontSize: '14px', color: '#333' }}>Individual</span>
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.6 : 1 }}>
                <input
                  type="checkbox"
                  checked={membershipFilter.has('Family')}
                  onChange={() => toggleMembershipFilter('Family')}
                  disabled={loading}
                  style={{ cursor: loading ? 'not-allowed' : 'pointer' }}
                />
                <span style={{ fontSize: '14px', color: '#333' }}>Family</span>
              </label>
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            onClick={runAudit}
            disabled={loading || !startDate || !endDate || !targetExpiration}
            style={{
              padding: '10px 20px',
              backgroundColor: loading ? '#ccc' : '#0056b3',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: loading ? 'not-allowed' : 'pointer',
              fontSize: '14px',
              fontWeight: '600'
            }}
          >
            {loading ? '⏳ Running...' : '▶ Run Audit'}
          </button>

          {auditResults && (
            <button
              onClick={exportResults}
              style={{
                padding: '10px 20px',
                backgroundColor: '#007d2f',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer',
                fontSize: '14px',
                fontWeight: '600'
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
          backgroundColor: '#fde4e4',
          border: '2px solid #d73a49',
          borderRadius: '4px',
          padding: '12px',
          marginBottom: '20px',
          color: '#d73a49',
          fontWeight: '500'
        }}>
          ⚠ {error}
        </div>
      )}

      {/* Summary */}
      {auditResults && auditResults.summary && (
        <div style={{
          backgroundColor: '#e8f4f8',
          border: '2px solid #0066cc',
          borderRadius: '6px',
          padding: '16px',
          marginBottom: '20px'
        }}>
          <h3 style={{ margin: '0 0 12px 0', fontSize: '16px', color: '#333' }}>📊 Audit Summary</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '12px' }}>
            <div style={{ backgroundColor: '#fff', padding: '12px', borderRadius: '4px', border: '1px solid #ccc' }}>
              <div style={{ fontSize: '12px', color: '#666', marginBottom: '4px' }}>Total Transactions</div>
              <div style={{ fontSize: '24px', fontWeight: 'bold', color: '#333' }}>
                {auditResults.summary.total_transactions || 0}
              </div>
            </div>
            <div style={{ backgroundColor: '#fff', padding: '12px', borderRadius: '4px', border: '1px solid #ccc' }}>
              <div style={{ fontSize: '12px', color: '#666', marginBottom: '4px' }}>Traced Members</div>
              <div style={{ fontSize: '24px', fontWeight: 'bold', color: '#0056b3' }}>
                {auditResults.summary.traced_members || 0}
              </div>
            </div>
            <div style={{ backgroundColor: '#fff', padding: '12px', borderRadius: '4px', border: '1px solid #ccc' }}>
              <div style={{ fontSize: '12px', color: '#666', marginBottom: '4px' }}>✓ Matched</div>
              <div style={{ fontSize: '24px', fontWeight: 'bold', color: '#007d2f' }}>
                {auditResults.summary.expirations_matched || 0}
              </div>
            </div>
            <div style={{ backgroundColor: '#fff', padding: '12px', borderRadius: '4px', border: '1px solid #ccc' }}>
              <div style={{ fontSize: '12px', color: '#666', marginBottom: '4px' }}>✗ Mismatched</div>
              <div style={{ fontSize: '24px', fontWeight: 'bold', color: '#d73a49' }}>
                {auditResults.summary.expirations_mismatched || 0}
              </div>
            </div>
            <div style={{ backgroundColor: '#fff', padding: '12px', borderRadius: '4px', border: '1px solid #ccc' }}>
              <div style={{ fontSize: '12px', color: '#666', marginBottom: '4px' }}>⚠ Not Traced</div>
              <div style={{ fontSize: '24px', fontWeight: 'bold', color: '#b08500' }}>
                {auditResults.summary.not_traced || 0}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Results Table */}
      {auditResults && filteredResults && filteredResults.length > 0 && (
        <div style={{ overflowX: 'auto' }}>
          <table style={{
            width: '100%',
            borderCollapse: 'collapse',
            fontSize: '13px',
            backgroundColor: 'white',
            border: '1px solid #ccc'
          }}>
            <thead>
              <tr style={{ backgroundColor: '#f0f0f0', borderBottom: '2px solid #999' }}>
                <th style={{ padding: '10px', textAlign: 'left', fontWeight: '600', minWidth: '50px', color: '#333' }}>▼</th>
                <th style={{ padding: '10px', textAlign: 'left', fontWeight: '600', color: '#333' }}>Transaction</th>
                <th style={{ padding: '10px', textAlign: 'left', fontWeight: '600', color: '#333' }}>Member</th>
                <th style={{ padding: '10px', textAlign: 'center', fontWeight: '600', minWidth: '100px', color: '#333' }}>Status</th>
                <th style={{ padding: '10px', textAlign: 'left', fontWeight: '600', color: '#333' }}>Trace Route</th>
                <th style={{ padding: '10px', textAlign: 'center', fontWeight: '600', minWidth: '80px', color: '#333' }}>Flags</th>
              </tr>
            </thead>
            <tbody>
              {filteredResults.map((entry, idx) => {
                const isExpanded = expandedRows.has(entry.transaction_id);
                const bgColor = entry.red_flags?.length > 0 ? '#fff5e6' : '#f5f5f5';
                return (
                  <React.Fragment key={idx}>
                    <tr style={{
                      borderBottom: '1px solid #ddd',
                      backgroundColor: '#f0f7ff'
                    }}>
                      <td style={{ padding: '10px', textAlign: 'center', color: '#333' }}>
                        <button
                          onClick={() => toggleRowExpand(entry.transaction_id)}
                          style={{
                            background: 'none',
                            border: 'none',
                            cursor: 'pointer',
                            fontSize: '14px',
                            padding: '0',
                            width: '30px',
                            color: '#333'
                          }}
                        >
                          {isExpanded ? '▼' : '▶'}
                        </button>
                      </td>
                      <td style={{ padding: '10px', color: '#333' }}>
                        <div style={{ fontWeight: '600', marginBottom: '4px' }}>
                          {entry.transaction_id.substring(0, 16)}...
                        </div>
                        <div style={{ color: '#666', fontSize: '12px', marginBottom: '4px' }}>
                          ${entry.amount?.toFixed(2) || 'N/A'} • {entry.transaction_date}
                        </div>
                        <div style={{ color: '#333', fontSize: '11px', marginBottom: '2px', wordBreak: 'break-word' }}>
                          <strong>From:</strong> {entry.sender || '—'}
                        </div>
                        <div style={{ color: '#333', fontSize: '11px', wordBreak: 'break-word' }}>
                          <strong>Memo:</strong> {entry.memo || '—'}
                        </div>
                      </td>
                      <td style={{ padding: '10px', color: '#333' }}>
                        <div style={{ fontWeight: '600' }}>{entry.member_name || '—'}</div>
                        <div style={{ color: '#666', fontSize: '12px' }}>
                          {entry.member_id || '—'} • {inferMembershipType(entry) || '—'}
                        </div>
                      </td>
                      <td style={{ padding: '10px', textAlign: 'center' }}>
                        <div style={{
                          display: 'inline-block',
                          padding: '4px 8px',
                          borderRadius: '4px',
                          backgroundColor: getStatusColor(entry.match_status),
                          color: 'white',
                          fontWeight: '600',
                          fontSize: '12px'
                        }}>
                          {getStatusIcon(entry.match_status)}
                        </div>
                      </td>
                      <td style={{ padding: '10px', fontSize: '12px', color: '#666' }}>
                        {entry.trace_route === 'NOT TRACED' ? '—' : entry.trace_route}
                      </td>
                      <td style={{ padding: '10px', textAlign: 'center' }}>
                        {entry.red_flags && entry.red_flags.length > 0 ? (
                          <div style={{ color: '#d73a49', fontWeight: '600', fontSize: '12px' }}>
                            {entry.red_flags.length}
                          </div>
                        ) : (
                          <div style={{ color: '#999', fontSize: '12px' }}>—</div>
                        )}
                      </td>
                    </tr>

                    {/* Expanded Details */}
                    {isExpanded && (
                      <tr style={{ backgroundColor: '#f0f7ff', borderBottom: '1px solid #ddd' }}>
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
                                    <li key={i} style={{ color: '#d73a49', marginBottom: '4px' }}>
                                      {flag}
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            )}

                            {entry.trace_route === 'NOT TRACED' && (
                              <div style={{ gridColumn: '1 / -1' }}>
                                <button
                                  onClick={() => unmatchTransaction(entry.transaction_id)}
                                  disabled={unmatching === entry.transaction_id}
                                  style={{
                                    padding: '8px 16px',
                                    backgroundColor: unmatching === entry.transaction_id ? '#ccc' : '#d73a49',
                                    color: 'white',
                                    border: 'none',
                                    borderRadius: '4px',
                                    cursor: unmatching === entry.transaction_id ? 'not-allowed' : 'pointer',
                                    fontSize: '13px',
                                    fontWeight: '600'
                                  }}
                                >
                                  {unmatching === entry.transaction_id ? '⏳ Unmatching...' : '🔌 Unmatch Transaction'}
                                </button>
                                <div style={{ fontSize: '11px', color: '#666', marginTop: '6px' }}>
                                  Resets ProcessedTime &amp; PaymentID in gmail_transactions
                                </div>
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

      {auditResults && filteredResults && filteredResults.length === 0 && auditResults.audit_results.length > 0 && (
        <div style={{
          backgroundColor: '#e8f4f8',
          border: '2px solid #0066cc',
          borderRadius: '4px',
          padding: '16px',
          textAlign: 'center',
          color: '#0056b3',
          fontWeight: '500'
        }}>
          No {[...membershipFilter].join(' or ')} transactions match the current filter.
        </div>
      )}

      {auditResults && auditResults.audit_results && auditResults.audit_results.length === 0 && (
        <div style={{
          backgroundColor: '#e8f4f8',
          border: '2px solid #0066cc',
          borderRadius: '4px',
          padding: '16px',
          textAlign: 'center',
          color: '#0056b3',
          fontWeight: '500'
        }}>
          ✓ No transactions found matching the specified criteria.
        </div>
      )}
    </div>
  );
};
