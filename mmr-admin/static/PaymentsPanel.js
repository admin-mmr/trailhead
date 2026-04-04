/**
 * PaymentsPanel — Payment reconciliation UI
 * Dashboard + 3 workflows (Pending, Autoguess, Manual) + always-visible Gmail transactions table
 * Redesigned to match old payments.js style with better table rendering
 */

const PaymentsPanel = () => {
  const { useState, useEffect } = React;

  const [dashboard, setDashboard] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [dashboardOpen, setDashboardOpen] = useState(true);
  const [gmailTransactions, setGmailTransactions] = useState([]);
  const [gmailLoading, setGmailLoading] = useState(false);
  const [activeTab, setActiveTab] = useState('pending-submissions');
  const [selectedGmailForQuickApprove, setSelectedGmailForQuickApprove] = useState(null);

  // Load dashboard on mount
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

  // Load gmail transactions
  useEffect(() => {
    loadGmailTransactions();
  }, []);

  const loadGmailTransactions = () => {
    setGmailLoading(true);
    window.api('/api/payments/unmatched-gmail?limit=100')
      .then(r => {
        if (r && r.transactions) {
          setGmailTransactions(r.transactions);
        }
        setGmailLoading(false);
      })
      .catch(e => {
        console.error('[Gmail] Error loading:', e);
        setGmailLoading(false);
      });
  };

  if (error) {
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
      </div>
    );
  }

  if (loading) {
    return <div style={{ padding: 20, textAlign: 'center', color: 'var(--text2)' }}>Loading payments dashboard...</div>;
  }

  if (!dashboard) {
    return <div style={{ color: 'var(--text2)', padding: 16 }}>No data available</div>;
  }

  const stats = [
    { label: 'Pending Submissions', value: dashboard.pending, icon: '⏳', color: '#f59e0b' },
    { label: 'Unmatched Gmail', value: dashboard.unmatched_gmail, icon: '📧', color: '#ef4444' },
    { label: 'Matched Payments', value: dashboard.matched, icon: '✓', color: '#10b981' },
  ];

  return (
    <div>
      {/* Collapsible Dashboard Section */}
      <div style={{ marginBottom: 24 }}>
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
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
              gap: 12,
            }}>
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
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            className={`tab ${activeTab === 'pending-submissions' ? 'active' : ''}`}
            onClick={() => setActiveTab('pending-submissions')}
            style={{
              padding: '8px 16px',
              background: activeTab === 'pending-submissions' ? 'var(--accent)' : 'transparent',
              border: activeTab === 'pending-submissions' ? 'none' : '1px solid var(--border)',
              color: activeTab === 'pending-submissions' ? 'white' : 'var(--text)',
              borderRadius: 'var(--radius)',
              cursor: 'pointer',
              fontSize: 13,
              fontWeight: 500,
            }}
          >
            📋 Pending ({dashboard.pending})
          </button>
          <button
            className={`tab ${activeTab === 'autoguess' ? 'active' : ''}`}
            onClick={() => setActiveTab('autoguess')}
            style={{
              padding: '8px 16px',
              background: activeTab === 'autoguess' ? 'var(--accent)' : 'transparent',
              border: activeTab === 'autoguess' ? 'none' : '1px solid var(--border)',
              color: activeTab === 'autoguess' ? 'white' : 'var(--text)',
              borderRadius: 'var(--radius)',
              cursor: 'pointer',
              fontSize: 13,
              fontWeight: 500,
            }}
          >
            🤖 Autoguess ({dashboard.unmatched_gmail})
          </button>
          <button
            className={`tab ${activeTab === 'manual-approval' ? 'active' : ''}`}
            onClick={() => setActiveTab('manual-approval')}
            style={{
              padding: '8px 16px',
              background: activeTab === 'manual-approval' ? 'var(--accent)' : 'transparent',
              border: activeTab === 'manual-approval' ? 'none' : '1px solid var(--border)',
              color: activeTab === 'manual-approval' ? 'white' : 'var(--text)',
              borderRadius: 'var(--radius)',
              cursor: 'pointer',
              fontSize: 13,
              fontWeight: 500,
            }}
          >
            ✓ Manual Approval
          </button>
        </div>
      </div>

      {/* Workflow Content */}
      <div style={{ marginBottom: 32 }}>
        {activeTab === 'pending-submissions' && <PendingSubmissionsView />}
        {activeTab === 'autoguess' && <AutoguessView />}
        {activeTab === 'manual-approval' && <ManualApprovalView />}
      </div>

      {/* Always-visible Gmail Transactions Section */}
      <div style={{ marginTop: 32, borderTop: '2px solid var(--border)', paddingTop: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <h3 style={{ fontSize: 16, fontWeight: 600 }}>
            📧 Gmail Transactions ({gmailTransactions.length})
          </h3>
          <button
            onClick={loadGmailTransactions}
            disabled={gmailLoading}
            style={{
              padding: '6px 12px',
              background: 'transparent',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius)',
              cursor: gmailLoading ? 'not-allowed' : 'pointer',
              fontSize: 12,
              opacity: gmailLoading ? 0.5 : 1,
            }}
          >
            {gmailLoading ? '⟳ Refreshing...' : '⟳ Refresh'}
          </button>
        </div>
        <p style={{ fontSize: 12, color: 'var(--text2)', marginBottom: 12 }}>
          💡 Click any row to quickly approve the payment
        </p>

        {gmailTransactions.length === 0 ? (
          <div style={{ padding: 20, textAlign: 'center', color: 'var(--text2)', background: 'var(--surface)', borderRadius: 'var(--radius)' }}>
            No unmatched Gmail transactions
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{
              width: '100%',
              borderCollapse: 'collapse',
              fontSize: 12,
              background: 'var(--surface)',
              borderRadius: 'var(--radius)',
              overflow: 'hidden',
            }}>
              <thead>
                <tr style={{ background: 'var(--bg)', borderBottom: '2px solid var(--border)' }}>
                  <th style={{ textAlign: 'left', padding: '10px 12px', fontWeight: 600, color: 'var(--text)' }}>Date</th>
                  <th style={{ textAlign: 'left', padding: '10px 12px', fontWeight: 600, color: 'var(--text)' }}>Sender</th>
                  <th style={{ textAlign: 'left', padding: '10px 12px', fontWeight: 600, color: 'var(--text)' }}>Memo</th>
                  <th style={{ textAlign: 'right', padding: '10px 12px', fontWeight: 600, color: 'var(--text)' }}>Amount</th>
                  <th style={{ textAlign: 'left', padding: '10px 12px', fontWeight: 600, color: 'var(--text)' }}>Method</th>
                  <th style={{ textAlign: 'left', padding: '10px 12px', fontWeight: 600, color: 'var(--text)' }}>ID</th>
                </tr>
              </thead>
              <tbody>
                {gmailTransactions.map((tx, idx) => (
                  <tr
                    key={tx.TransactionNumber || idx}
                    onClick={() => setSelectedGmailForQuickApprove(tx)}
                    style={{
                      borderBottom: '1px solid var(--border)',
                      background: idx % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.02)',
                      transition: 'background 0.2s',
                      cursor: 'pointer',
                    }}
                    onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(79, 172, 254, 0.2)'}
                    onMouseLeave={(e) => e.currentTarget.style.background = idx % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.02)'}
                  >
                    <td style={{ padding: '10px 12px', color: 'var(--text2)', fontFamily: 'monospace', fontSize: 11 }}>
                      {tx.TransactionDate?.split('T')[0] || '—'}
                    </td>
                    <td style={{ padding: '10px 12px', color: 'var(--text)' }}>
                      {tx.Sender || '—'}
                    </td>
                    <td style={{ padding: '10px 12px', color: 'var(--text)', maxWidth: 300, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {tx.Memo || '—'}
                    </td>
                    <td style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 600, color: '#10b981' }}>
                      ${parseFloat(tx.Amount).toFixed(2)}
                    </td>
                    <td style={{ padding: '10px 12px', color: 'var(--text2)', fontSize: 11 }}>
                      {tx.PaymentMethod || '—'}
                    </td>
                    <td style={{ padding: '10px 12px', color: 'var(--text2)', fontFamily: 'monospace', fontSize: 11 }}>
                      {tx.TransactionNumber?.slice(0, 12) || '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Quick Approve Modal */}
      {selectedGmailForQuickApprove && (
        <QuickApproveModal
          gmail={selectedGmailForQuickApprove}
          onClose={() => setSelectedGmailForQuickApprove(null)}
          onSuccess={() => {
            setSelectedGmailForQuickApprove(null);
            loadGmailTransactions();
          }}
        />
      )}
    </div>
  );
};

// ============================================================================
// QUICK APPROVE MODAL
// ============================================================================

const QuickApproveModal = ({ gmail, onClose, onSuccess }) => {
  const { useState } = React;
  const [memberId, setMemberId] = useState('');
  const [memberSearch, setMemberSearch] = useState('');
  const [members, setMembers] = useState([]);
  const [memberData, setMemberData] = useState(null);
  const [approving, setApproving] = useState(false);
  const [result, setResult] = useState(null);

  const handleSearchMembers = (query) => {
    setMemberSearch(query);
    if (query.length < 2) {
      setMembers([]);
      return;
    }
    window.api(`/api/payments/search-members?q=${encodeURIComponent(query)}`)
      .then(r => {
        if (r && r.members) setMembers(r.members);
      })
      .catch(e => console.error('[QuickApprove] Search error:', e));
  };

  const handleSelectMember = (member) => {
    setMemberId(member.MemberID);
    setMemberSearch('');
    setMembers([]);
    setMemberData(member);
  };

  const handleApprove = () => {
    if (!memberId) return;
    setApproving(true);
    window.api('/api/payments/manual-approve', {
      method: 'POST',
      body: JSON.stringify({ memberId, transactionNumber: gmail.TransactionNumber }),
    })
      .then(r => {
        console.log('[QuickApprove] Result:', r);
        if (r.ok) {
          setResult({ ok: true, message: r.message || 'Payment approved!' });
          setTimeout(() => onSuccess(), 1500);
        } else {
          setResult({ ok: false, error: r.error || 'Failed to approve' });
        }
        setApproving(false);
      })
      .catch(e => {
        console.error('[QuickApprove] Error:', e);
        setResult({ ok: false, error: e.message });
        setApproving(false);
      });
  };

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: 'rgba(0,0,0,0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 100,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--surface)',
          borderRadius: 'var(--radius)',
          padding: 24,
          maxWidth: 500,
          width: '90%',
          boxShadow: '0 8px 32px rgba(0,0,0,0.3)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h3 style={{ fontSize: 16, fontWeight: 600 }}>⚡ Quick Approve Payment</h3>
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              fontSize: 20,
              color: 'var(--text2)',
            }}
          >
            ✕
          </button>
        </div>

        {/* Transaction Details */}
        <div
          style={{
            background: 'var(--bg)',
            padding: 12,
            borderRadius: 'var(--radius)',
            marginBottom: 16,
            fontSize: 12,
            color: 'var(--text2)',
          }}
        >
          <div>Sender: {gmail.Sender || '—'}</div>
          <div>Amount: ${parseFloat(gmail.Amount).toFixed(2)} · Date: {gmail.TransactionDate?.split('T')[0]}</div>
          <div style={{ wordBreak: 'break-all', marginTop: 4 }}>Memo: {gmail.Memo || '—'}</div>
        </div>

        {result ? (
          <div
            style={{
              background: result.ok ? '#f0fdf4' : '#fef2f2',
              border: `1px solid ${result.ok ? '#86efac' : '#fca5a5'}`,
              borderRadius: 'var(--radius)',
              padding: 12,
              textAlign: 'center',
              color: result.ok ? '#15803d' : '#b91c1c',
              fontSize: 13,
              marginBottom: 16,
            }}
          >
            {result.ok ? '✅ ' : '❌ '}
            {result.ok ? result.message : result.error}
          </div>
        ) : (
          <>
            {/* Member Search */}
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 6, color: 'var(--text)' }}>
                Search Member
              </label>
              <input
                type="text"
                placeholder="Name, email, or ID..."
                value={memberSearch}
                onChange={(e) => handleSearchMembers(e.target.value)}
                style={{
                  width: '100%',
                  padding: '10px 12px',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--radius)',
                  fontSize: 13,
                  background: 'var(--bg)',
                  color: 'var(--text)',
                  boxSizing: 'border-box',
                }}
              />
              {members.length > 0 && (
                <div
                  style={{
                    marginTop: 6,
                    background: 'var(--bg)',
                    border: '1px solid var(--border)',
                    borderRadius: 'var(--radius)',
                    maxHeight: 150,
                    overflowY: 'auto',
                  }}
                >
                  {members.map((m) => (
                    <button
                      key={m.MemberID}
                      onClick={() => handleSelectMember(m)}
                      style={{
                        display: 'block',
                        width: '100%',
                        textAlign: 'left',
                        padding: '10px 12px',
                        background: 'transparent',
                        border: 'none',
                        borderBottom: '1px solid var(--border)',
                        cursor: 'pointer',
                        fontSize: 12,
                      }}
                    >
                      <strong>{m.FirstName} {m.LastName}</strong> <span style={{ color: 'var(--text2)', fontSize: 11 }}>({m.MemberID})</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Selected Member */}
            {memberData && (
              <div
                style={{
                  background: '#f0fdf4',
                  border: '1px solid #86efac',
                  borderRadius: 'var(--radius)',
                  padding: 12,
                  marginBottom: 16,
                  fontSize: 12,
                }}
              >
                <div style={{ fontWeight: 600, color: '#15803d' }}>✓ {memberData.FirstName} {memberData.LastName}</div>
                <div style={{ color: 'var(--text2)', marginTop: 2 }}>{memberData.MemberID}</div>
                {memberData.Expiration && (
                  <div style={{ color: 'var(--text2)', fontSize: 11, marginTop: 2 }}>
                    Expires: {memberData.Expiration?.split('T')[0]}
                  </div>
                )}
              </div>
            )}

            {/* Action Button */}
            <button
              onClick={handleApprove}
              disabled={!memberId || approving}
              style={{
                width: '100%',
                padding: '12px 16px',
                background: !memberId || approving ? '#ccc' : '#10b981',
                color: 'white',
                border: 'none',
                borderRadius: 'var(--radius)',
                cursor: !memberId || approving ? 'not-allowed' : 'pointer',
                fontSize: 14,
                fontWeight: 600,
                opacity: !memberId || approving ? 0.6 : 1,
              }}
            >
              {approving ? '⟳ Approving...' : '✓ Approve Payment'}
            </button>
          </>
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
    window.api('/api/payments/pending-submissions?limit=100')
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
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, background: 'var(--surface)', borderRadius: 'var(--radius)' }}>
              <thead>
                <tr style={{ background: 'var(--bg)', borderBottom: '2px solid var(--border)' }}>
                  <th style={{ textAlign: 'left', padding: '10px 12px', fontWeight: 600 }}>Member ID</th>
                  <th style={{ textAlign: 'left', padding: '10px 12px', fontWeight: 600 }}>Name</th>
                  <th style={{ textAlign: 'left', padding: '10px 12px', fontWeight: 600 }}>Type</th>
                  <th style={{ textAlign: 'right', padding: '10px 12px', fontWeight: 600 }}>Amount</th>
                  <th style={{ textAlign: 'left', padding: '10px 12px', fontWeight: 600 }}>Created</th>
                  <th style={{ textAlign: 'left', padding: '10px 12px', fontWeight: 600 }}>Expires</th>
                </tr>
              </thead>
              <tbody>
                {submissions.map((s, idx) => (
                  <tr
                    key={s.SubmissionID || idx}
                    style={{
                      borderBottom: '1px solid var(--border)',
                      background: idx % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.02)',
                    }}
                  >
                    <td style={{ padding: '10px 12px', fontFamily: 'monospace', color: 'var(--accent)' }}>{s.MemberID}</td>
                    <td style={{ padding: '10px 12px' }}>{s.FirstName} {s.LastName}</td>
                    <td style={{ padding: '10px 12px', color: 'var(--text2)' }}>{s.SubmissionType}</td>
                    <td style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 600, color: '#10b981' }}>${parseFloat(s.Amount).toFixed(2)}</td>
                    <td style={{ padding: '10px 12px', color: 'var(--text2)', fontSize: 11 }}>{s.CreatedAt?.split('T')[0]}</td>
                    <td style={{ padding: '10px 12px', color: 'var(--text2)', fontSize: 11 }}>{s.ExpiresAt?.split('T')[0]}</td>
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
    setResult(null);
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
        onClick={handleAutoguess}
        disabled={autoguessing}
        style={{
          padding: '12px 24px',
          background: autoguessing ? '#ccc' : 'var(--accent)',
          color: 'white',
          border: 'none',
          borderRadius: 'var(--radius)',
          cursor: autoguessing ? 'not-allowed' : 'pointer',
          fontSize: 14,
          fontWeight: 600,
          marginBottom: 16,
          transition: 'opacity 0.2s',
          opacity: autoguessing ? 0.6 : 1,
        }}
      >
        {autoguessing ? '⟳ Running autoguess...' : '🤖 Run Autoguess'}
      </button>

      {result && (
        <div
          style={{
            background: result.error ? '#fef2f2' : '#f0fdf4',
            border: `1px solid ${result.error ? '#fca5a5' : '#86efac'}`,
            borderRadius: 'var(--radius)',
            padding: 16,
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
              <strong>✅ Success:</strong> {result.message}
              {result.details && (
                <div style={{ marginTop: 12, fontSize: 12, opacity: 0.8 }}>
                  Created: {result.details.created} | Skipped: {result.details.skipped} | Errors: {result.details.errors?.length || 0}
                </div>
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
  const [memberSearch, setMemberSearch] = useState('');
  const [members, setMembers] = useState([]);
  const [selectedMemberId, setSelectedMemberId] = useState('');
  const [memberSubmissions, setMemberSubmissions] = useState([]);
  const [gmailMatches, setGmailMatches] = useState([]);
  const [selectedTx, setSelectedTx] = useState('');
  const [approving, setApproving] = useState(false);
  const [result, setResult] = useState(null);

  const handleSearchMembers = (query) => {
    setMemberSearch(query);
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
    setMemberSearch('');
    setMemberSubmissions([]);
    setGmailMatches([]);
    setSelectedTx('');
    setResult(null);

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
          setTimeout(() => {
            setSelectedMemberId('');
            setSelectedTx('');
            setMemberSubmissions([]);
            setGmailMatches([]);
          }, 1500);
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
        <div>
          <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 8, color: 'var(--text)' }}>
            Search Member
          </label>
          <input
            type="text"
            placeholder="Name, email, or ID..."
            value={memberSearch}
            onChange={(e) => handleSearchMembers(e.target.value)}
            style={{
              width: '100%',
              padding: '10px 12px',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius)',
              fontSize: 13,
              background: 'var(--surface)',
              color: 'var(--text)',
            }}
          />
          {members.length > 0 && (
            <div
              style={{
                marginTop: 8,
                background: 'var(--surface)',
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
                    padding: '10px 12px',
                    background: 'transparent',
                    border: 'none',
                    borderBottom: '1px solid var(--border)',
                    cursor: 'pointer',
                    fontSize: 13,
                  }}
                >
                  <strong>{m.FirstName} {m.LastName}</strong> <span style={{ color: 'var(--text2)', fontSize: 11 }}>({m.MemberID})</span>
                </button>
              ))}
            </div>
          )}
          {selectedMemberId && (
            <div style={{ marginTop: 8, padding: 10, background: '#f0fdf4', border: '1px solid #86efac', borderRadius: 'var(--radius)', fontSize: 12 }}>
              ✓ Selected: <strong>{selectedMemberId}</strong>
            </div>
          )}
        </div>

        <div>
          <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 8, color: 'var(--text)' }}>
            Select Gmail Transaction
          </label>
          <select
            value={selectedTx}
            onChange={(e) => setSelectedTx(e.target.value)}
            disabled={!selectedMemberId || gmailMatches.length === 0}
            style={{
              width: '100%',
              padding: '10px 12px',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius)',
              fontSize: 13,
              background: 'var(--surface)',
              color: 'var(--text)',
              opacity: !selectedMemberId || gmailMatches.length === 0 ? 0.5 : 1,
              cursor: !selectedMemberId || gmailMatches.length === 0 ? 'not-allowed' : 'pointer',
            }}
          >
            <option value="">-- Select transaction --</option>
            {gmailMatches.map((tx) => (
              <option key={tx.TransactionNumber} value={tx.TransactionNumber}>
                ${parseFloat(tx.Amount).toFixed(2)} - {tx.Sender} - {tx.TransactionDate}
              </option>
            ))}
          </select>
        </div>
      </div>

      <button
        onClick={handleApprove}
        disabled={!selectedMemberId || !selectedTx || approving}
        style={{
          padding: '12px 24px',
          background: !selectedMemberId || !selectedTx || approving ? '#ccc' : '#10b981',
          color: 'white',
          border: 'none',
          borderRadius: 'var(--radius)',
          cursor: !selectedMemberId || !selectedTx || approving ? 'not-allowed' : 'pointer',
          fontSize: 14,
          fontWeight: 600,
          marginBottom: 16,
          opacity: !selectedMemberId || !selectedTx || approving ? 0.6 : 1,
        }}
      >
        {approving ? '⟳ Approving...' : '✓ Approve Payment'}
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
              <strong>✅ Approved:</strong> {result.message}
            </>
          )}
        </div>
      )}
    </div>
  );
};

window.PaymentsPanel = PaymentsPanel;
