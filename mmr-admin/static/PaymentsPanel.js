/**
 * PaymentsPanel — Payment reconciliation UI
 * Shows dashboard stats and links to pending items
 */

const PaymentsPanel = () => {
  const { useState, useEffect } = React;

  const [dashboard, setDashboard] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [activeTab, setActiveTab] = useState('overview');

  useEffect(() => {
    console.log('[PaymentsPanel] Mounting, fetching dashboard data...');
    console.log('[PaymentsPanel] api function available?', typeof window.api);

    if (typeof window.api !== 'function') {
      console.error('[PaymentsPanel] ERROR: window.api is not a function!', window.api);
      setError('API not available');
      setLoading(false);
      return;
    }

    window.api('/api/payments/dashboard')
      .then(r => {
        console.log('[PaymentsPanel] Dashboard API response:', r);
        if (r && r.ok) {
          console.log('[PaymentsPanel] Dashboard data received:', r);
          setDashboard(r);
          setLoading(false);
        } else {
          console.error('[PaymentsPanel] Response not ok:', r);
          setError(`API error: ${r?.error || 'Unknown error'}`);
          setLoading(false);
        }
      })
      .catch(e => {
        console.error('[PaymentsPanel] API call failed:', e);
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
      <div style={{ marginBottom: 24 }}>
        <h2 style={{ marginBottom: 16 }}>💰 Payment Reconciliation Dashboard</h2>

        {/* Stats Grid */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
            gap: 12,
            marginBottom: 24,
          }}
        >
          {stats.map((stat) => (
            <div
              key={stat.label}
              style={{
                background: 'var(--surface)',
                border: `1px solid ${stat.color}`,
                borderRadius: 'var(--radius)',
                padding: 16,
                textAlign: 'center',
              }}
            >
              <div style={{ fontSize: 32, marginBottom: 8 }}>{stat.icon}</div>
              <div style={{ fontSize: 28, fontWeight: 600, color: stat.color, marginBottom: 6 }}>
                {stat.value}
              </div>
              <div style={{ fontSize: 13, color: 'var(--text2)' }}>{stat.label}</div>
            </div>
          ))}
        </div>

        {/* Action Buttons */}
        <div
          style={{
            display: 'flex',
            gap: 12,
            flexWrap: 'wrap',
            padding: 16,
            background: 'var(--surface)',
            borderRadius: 'var(--radius)',
            border: '1px solid var(--border)',
          }}
        >
          <button
            className="btn btn-primary"
            onClick={() => setActiveTab('pending')}
            style={{
              flex: '1 0 auto',
              minWidth: 180,
            }}
          >
            Review Pending Submissions ({dashboard.pending})
          </button>
          <button
            className="btn btn-outline"
            onClick={() => setActiveTab('unmatched')}
            style={{
              flex: '1 0 auto',
              minWidth: 180,
            }}
          >
            Review Unmatched Gmail ({dashboard.unmatched_gmail})
          </button>
        </div>
      </div>

      {/* Content Placeholder */}
      <div
        style={{
          padding: 24,
          background: 'var(--surface)',
          borderRadius: 'var(--radius)',
          border: '1px solid var(--border)',
          color: 'var(--text2)',
          textAlign: 'center',
        }}
      >
        <p>
          {activeTab === 'overview'
            ? 'View payment reconciliation details above'
            : activeTab === 'pending'
            ? 'Pending submissions view coming soon'
            : 'Unmatched gmail view coming soon'}
        </p>
      </div>
    </div>
  );
};

window.PaymentsPanel = PaymentsPanel;
