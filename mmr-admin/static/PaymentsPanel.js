/**
 * PaymentsPanel — Payment reconciliation UI
 * Dashboard with collapsible stats + workflows: autoguess, manual approval, pending submissions
 */

const PaymentsPanel = () => {
  const { useState, useEffect } = React;

  const [dashboard, setDashboard] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [dashboardOpen, setDashboardOpen] = useState(true);
  const [activeTab, setActiveTab] = useState('pending-submissions');

  useEffect(() => {
    console.log('[PaymentsPanel] Mounting, fetching dashboard data...');
    console.log('[PaymentsPanel] api function available?', typeof window.api);

    if (typeof window.api !== 'function') {
      console.error('[PaymentsPanel] ERROR: window.api is not a function!', window.api);
      setError('API not available');
      setLoading(false);
      return;
    }

    console.log('[PaymentsPanel] Calling /api/payments/dashboard...');
    window.api('/api/payments/dashboard')
      .then(r => {
        console.log('[PaymentsPanel] Raw API response:', r);
        console.log('[PaymentsPanel] Response type:', typeof r);
        console.log('[PaymentsPanel] Response keys:', Object.keys(r || {}));

        // Check if response has ok property or has expected data fields
        const hasData = r && (r.pending !== undefined || r.ok === true);
        const hasError = r && r.error !== undefined && r.ok === false;

        if (hasData && !hasError) {
          console.log('[PaymentsPanel] Dashboard data received:', r);
          setDashboard(r);
          setLoading(false);
        } else {
          console.error('[PaymentsPanel] Response not ok:', r);
          console.error('[PaymentsPanel] Error message:', r?.error);
          setError(`API error: ${r?.error || 'Unknown error (check console)'}`);
          setLoading(false);
        }
      })
      .catch(e => {
        console.error('[PaymentsPanel] API call failed:', e);
        console.error('[PaymentsPanel] Error stack:', e.stack);
        setError(`Fetch error: ${e.message}`);
        setLoading(false);
      });
  }, []);

  if (error) {
    console.error('[PaymentsPanel] Rendering error state:', error);
    return (
      <div style={{
        background: '#fef2f2',
        border: '1px solid #fca5a5',
        borderRadius: 'var(--radius)',
        padding: 16,
        color: '#b91c1c',
      }}>
        <strong>❌ Error Loading Payments:</strong>
        <p style={{ marginTop: 8, fontFamily: 'monospace', fontSize: 12 }}>{error}</p>
        <p style={{ marginTop: 12, fontSize: 12, opacity: 0.8 }}>
          Check browser console for more details.
        </p>
      </div>
    );
  }

  if (loading) {
    console.log('[PaymentsPanel] Rendering loading state');
    return <div className="loading"><span className="spinner" /> Loading payments...</div>;
  }

  if (!dashboard) {
    console.warn('[PaymentsPanel] No dashboard data after loading');
    return <div style={{ color: 'var(--text2)', padding: 16 }}>No data available</div>;
  }

  console.log('[PaymentsPanel] Rendering with dashboard data:', dashboard);

  const stats = [
    { label: 'Pending Submissions', value: dashboard.pending, icon: '⏳', color: '#f59e0b' },
    { label: 'Unmatched Gmail', value: dashboard.unmatched_gmail, icon: '📧', color: '#ef4444' },
    { label: 'Matched Payments', value: dashboard.matched, icon: '✓', color: '#10b981' },
    { label: 'Approved (30d)', value: dashboard.approved_30d, icon: '✅', color: '#10b981' },
    { label: 'Rejected (30d)', value: dashboard.rejected_30d, icon: '❌', color: '#6b7280' },
    { label: 'Errors (7d)', value: dashboard.errors, icon: '⚠️', color: '#ef4444' },
  ];

  return (
    <div>
      {/* Collapsible Dashboard Section */}
      <div style={{ marginBottom: 20 }}>
        <button
          onClick={() => setDashboardOpen(!dashboardOpen)}
          style={{
            background: 'transparent',
            border: 'none',
            padding: 0,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            fontSize: 20,
            fontWeight: 600,
            color: 'var(--text)',
          }}
        >
          <span style={{ transform: dashboardOpen ? 'rotate(0deg)' : 'rotate(-90deg)', transition: 'transform 0.2s' }}>
            ▼
          </span>
          💰 Dashboard
        </button>

        {dashboardOpen && (
          <div style={{ marginTop: 16 }}>
            {/* Stats Grid */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
                gap: 12,
                marginBottom: 16,
              }}
            >
              {stats.map((stat) => (
                <div
                  key={stat.label}
                  style={{
                    background: 'var(--surface)',
                    border: `1px solid ${stat.color}`,
                    borderRadius: 'var(--radius)',
                    padding: 12,
                    textAlign: 'center',
                  }}
                >
                  <div style={{ fontSize: 28, marginBottom: 6 }}>{stat.icon}</div>
                  <div style={{ fontSize: 24, fontWeight: 600, color: stat.color, marginBottom: 4 }}>
                    {stat.value}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text2)' }}>{stat.label}</div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Workflow Tabs */}
      <div style={{ borderBottom: '1px solid var(--border)', paddingBottom: 8, marginBottom: 20 }}>
        <div className="tabs" style={{ display: 'flex', gap: 8 }}>
          <button
            className={`tab ${activeTab === 'pending-submissions' ? 'active' : ''}`}
            onClick={() => setActiveTab('pending-submissions')}
          >
            📋 Pending Submissions ({dashboard.pending})
          </button>
          <button
            className={`tab ${activeTab === 'autoguess' ? 'active' : ''}`}
            onClick={() => setActiveTab('autoguess')}
          >
            🤖 Autoguess ({dashboard.unmatched_gmail})
          </button>
          <button
            className={`tab ${activeTab === 'manual-approval' ? 'active' : ''}`}
            onClick={() => setActiveTab('manual-approval')}
          >
            ✓ Manual Approval
          </button>
        </div>
      </div>

      {/* Tab Content */}
      <div>
        {activeTab === 'pending-submissions' && (
          <div style={{ padding: 16, background: 'var(--surface)', borderRadius: 'var(--radius)' }}>
            <p style={{ color: 'var(--text2)', marginBottom: 12 }}>
              Pending membership submissions waiting for payment matching.
            </p>
            <PendingSubmissionsView />
          </div>
        )}

        {activeTab === 'autoguess' && (
          <div style={{ padding: 16, background: 'var(--surface)', borderRadius: 'var(--radius)' }}>
            <p style={{ color: 'var(--text2)', marginBottom: 12 }}>
              Unmatched Gmail transactions. Run autoguess to suggest matches based on member IDs and amounts.
            </p>
            <AutoguessView />
          </div>
        )}

        {activeTab === 'manual-approval' && (
          <div style={{ padding: 16, background: 'var(--surface)', borderRadius: 'var(--radius)' }}>
            <p style={{ color: 'var(--text2)', marginBottom: 12 }}>
              Manually approve payments by selecting a member and Gmail transaction.
            </p>
            <ManualApprovalView />
          </div>
        )}
      </div>
    </div>
  );
};

// ============================================================================
// PENDING SUBMISSIONS VIEW
// ============================================================================

const PendingSubmissionsView = () => {
  const { useState, useEffect } = React;
  const [submissions, setSubmissions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [showTable, setShowTable] = useState(true);

  const loadSubmissions = () => {
    setLoading(true);
    window.api('/api/payments/pending-submissions')
      .then(r => {
        if (r && r.submissions) {
          setSubmissions(r.submissions);
        }
        setLoading(false);
      })
      .catch(e => {
        console.error('[PendingSubmissions] Error:', e);
        setLoading(false);
      });
  };

  useEffect(() => {
    loadSubmissions();
  }, []);

  return (
    <div>
      <button
        onClick={() => setShowTable(!showTable)}
        style={{
          background: 'transparent',
          border: 'none',
          cursor: 'pointer',
          padding: '8px 0',
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          color: 'var(--accent)',
          fontSize: 14,
          fontWeight: 500,
          marginBottom: 12,
        }}
      >
        <span style={{ transform: showTable ? 'rotate(0deg)' : 'rotate(-90deg)', transition: 'transform 0.2s' }}>
          ▼
        </span>
        {showTable ? 'Hide' : 'Show'} Submissions ({submissions.length})
      </button>

      {showTable && (
        <div style={{ overflowX: 'auto' }}>
          {loading ? (
            <div style={{ textAlign: 'center', padding: 20, color: 'var(--text2)' }}>Loading...</div>
          ) : submissions.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 20, color: 'var(--text2)' }}>No pending submissions</div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)' }}>
                  <th style={{ textAlign: 'left', padding: 8, fontWeight: 600 }}>Member ID</th>
                  <th style={{ textAlign: 'left', padding: 8, fontWeight: 600 }}>Name</th>
                  <th style={{ textAlign: 'left', padding: 8, fontWeight: 600 }}>Type</th>
                  <th style={{ textAlign: 'right', padding: 8, fontWeight: 600 }}>Amount</th>
                  <th style={{ textAlign: 'left', padding: 8, fontWeight: 600 }}>Created</th>
                  <th style={{ textAlign: 'left', padding: 8, fontWeight: 600 }}>Expires</th>
                </tr>
              </thead>
              <tbody>
                {submissions.map((s) => (
                  <tr key={s.SubmissionID} style={{ borderBottom: '1px solid var(--border)', fontSize: 12 }}>
                    <td style={{ padding: 8, fontFamily: 'monospace' }}>{s.MemberID}</td>
                    <td style={{ padding: 8 }}>{s.FirstName} {s.LastName}</td>
                    <td style={{ padding: 8 }}>{s.SubmissionType}</td>
                    <td style={{ padding: 8, textAlign: 'right' }}>${s.Amount}</td>
                    <td style={{ padding: 8, color: 'var(--text2)', fontSize: 11 }}>{s.CreatedAt?.split('T')[0]}</td>
                    <td style={{ padding: 8, color: 'var(--text2)', fontSize: 11 }}>{s.ExpiresAt?.split('T')[0]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
};

// ============================================================================
// AUTOGUESS VIEW
// ============================================================================

const AutoguessView = () => {
  const { useState } = React;
  const [autoguessing, setAutoguessing] = useState(false);
  const [result, setResult] = useState(null);

  const handleAutoguess = () => {
    setAutoguessing(true);
    window.api('/api/payments/autoguess-all', { method: 'POST' })
      .then(r => {
        console.log('[Autoguess] Result:', r);
        setResult(r);
        setAutoguessing(false);
      })
      .catch(e => {
        console.error('[Autoguess] Error:', e);
        setResult({ error: e.message });
        setAutoguessing(false);
      });
  };

  return (
    <div>
      <button
        className="btn btn-primary"
        onClick={handleAutoguess}
        disabled={autoguessing}
        style={{ marginBottom: 16 }}
      >
        {autoguessing ? 'Running autoguess...' : '🤖 Run Autoguess'}
      </button>

      {result && (
        <div
          style={{
            background: result.error ? '#fef2f2' : '#f0fdf4',
            border: `1px solid ${result.error ? '#fca5a5' : '#86efac'}`,
            borderRadius: 'var(--radius)',
            padding: 12,
            fontSize: 13,
            color: result.error ? '#b91c1c' : '#15803d',
          }}
        >
          {result.error ? (
            <>
              <strong>❌ Error:</strong> {result.error}
            </>
          ) : (
            <>
              <strong>✅ Autoguess complete:</strong> {result.message}
              {result.details && (
                <pre style={{ marginTop: 8, fontSize: 11, whiteSpace: 'pre-wrap', opacity: 0.8 }}>
                  {JSON.stringify(result.details, null, 2)}
                </pre>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
};

// ============================================================================
// MANUAL APPROVAL VIEW
// ============================================================================

const ManualApprovalView = () => {
  const { useState } = React;
  const [members, setMembers] = useState([]);
  const [selectedMemberId, setSelectedMemberId] = useState('');
  const [memberSubmissions, setMemberSubmissions] = useState([]);
  const [gmailMatches, setGmailMatches] = useState([]);
  const [selectedTx, setSelectedTx] = useState('');
  const [approving, setApproving] = useState(false);
  const [result, setResult] = useState(null);

  const handleSearchMembers = (query) => {
    if (query.length < 2) {
      setMembers([]);
      return;
    }
    window.api(`/api/payments/search-members?q=${encodeURIComponent(query)}`)
      .then(r => {
        if (r && r.members) setMembers(r.members);
      })
      .catch(e => console.error('[ManualApproval] Search error:', e));
  };

  const handleSelectMember = (memberId) => {
    setSelectedMemberId(memberId);
    setMembers([]);
    setMemberSubmissions([]);
    setGmailMatches([]);

    // Load pending submissions and gmail matches for this member
    Promise.all([
      window.api(`/api/payments/submissions-for-member/${memberId}`),
      window.api(`/api/payments/gmail-matching-candidates/${memberId}`),
    ])
      .then(([subR, gmailR]) => {
        if (subR && subR.submissions) setMemberSubmissions(subR.submissions);
        if (gmailR && gmailR.transactions) setGmailMatches(gmailR.transactions);
      })
      .catch(e => console.error('[ManualApproval] Load error:', e));
  };

  const handleApprove = () => {
    if (!selectedMemberId || !selectedTx) return;
    setApproving(true);
    window.api('/api/payments/manual-approve', {
      method: 'POST',
      body: JSON.stringify({ memberId: selectedMemberId, transactionNumber: selectedTx }),
    })
      .then(r => {
        console.log('[ManualApproval] Result:', r);
        setResult(r);
        setApproving(false);
        if (r.ok) {
          setSelectedMemberId('');
          setSelectedTx('');
          setMemberSubmissions([]);
          setGmailMatches([]);
        }
      })
      .catch(e => {
        console.error('[ManualApproval] Error:', e);
        setResult({ error: e.message });
        setApproving(false);
      });
  };

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
        {/* Member Search */}
        <div>
          <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 6 }}>Search Member</label>
          <input
            type="text"
            placeholder="Name, email, or ID..."
            onChange={(e) => handleSearchMembers(e.target.value)}
            style={{
              width: '100%',
              padding: '8px 10px',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius)',
              fontSize: 12,
            }}
          />
          {members.length > 0 && (
            <div
              style={{
                marginTop: 8,
                background: 'var(--bg)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius)',
                maxHeight: 200,
                overflowY: 'auto',
              }}
            >
              {members.map((m) => (
                <button
                  key={m.MemberID}
                  onClick={() => handleSelectMember(m.MemberID)}
                  style={{
                    display: 'block',
                    width: '100%',
                    textAlign: 'left',
                    padding: '8px 10px',
                    background: 'transparent',
                    border: 'none',
                    borderBottom: '1px solid var(--border)',
                    cursor: 'pointer',
                    fontSize: 12,
                  }}
                >
                  <strong>{m.FirstName} {m.LastName}</strong> ({m.MemberID})
                </button>
              ))}
            </div>
          )}
          {selectedMemberId && (
            <div style={{ marginTop: 8, padding: 8, background: 'var(--surface)', borderRadius: 'var(--radius)', fontSize: 12 }}>
              ✓ Selected: <strong>{selectedMemberId}</strong>
            </div>
          )}
        </div>

        {/* Gmail Transaction Search */}
        <div>
          <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 6 }}>Select Gmail Transaction</label>
          <select
            value={selectedTx}
            onChange={(e) => setSelectedTx(e.target.value)}
            disabled={!selectedMemberId || gmailMatches.length === 0}
            style={{
              width: '100%',
              padding: '8px 10px',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius)',
              fontSize: 12,
            }}
          >
            <option value="">-- Select transaction --</option>
            {gmailMatches.map((tx) => (
              <option key={tx.TransactionNumber} value={tx.TransactionNumber}>
                ${tx.Amount} - {tx.Sender} - {tx.TransactionDate}
              </option>
            ))}
          </select>
        </div>
      </div>

      <button
        className="btn btn-primary"
        onClick={handleApprove}
        disabled={!selectedMemberId || !selectedTx || approving}
        style={{ marginBottom: 16 }}
      >
        {approving ? 'Approving...' : '✓ Approve Payment'}
      </button>

      {result && (
        <div
          style={{
            background: result.error ? '#fef2f2' : '#f0fdf4',
            border: `1px solid ${result.error ? '#fca5a5' : '#86efac'}`,
            borderRadius: 'var(--radius)',
            padding: 12,
            fontSize: 13,
            color: result.error ? '#b91c1c' : '#15803d',
          }}
        >
          {result.error ? (
            <>
              <strong>❌ Error:</strong> {result.error}
            </>
          ) : (
            <>
              <strong>✅ Payment approved:</strong> {result.message}
            </>
          )}
        </div>
      )}
    </div>
  );
};

window.PaymentsPanel = PaymentsPanel;
