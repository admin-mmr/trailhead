/**
 * PaymentsPanel — Payment reconciliation UI
 * Shows dashboard stats and links to pending items
 */

const PaymentsPanel = () => {
  const [dashboard, setDashboard] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('overview');

  useEffect(() => {
    api('/api/payments/dashboard').then(r => {
      if (r.ok) {
        setDashboard(r);
        setLoading(false);
      } else {
        setLoading(false);
      }
    });
  }, []);

  if (loading) {
    return <div className="loading"><span className="spinner" /> Loading payments...</div>;
  }

  if (!dashboard) {
    return <div style={{ color: 'var(--text2)', padding: 16 }}>No data available</div>;
  }

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
