/**
 * ManualEventMatchModalParts.js — presentational pieces for ManualEventMatchModal.
 *
 * Extracted from ManualEventMatchModal.js to keep each file under the 300-line
 * code-health limit. Defines the transaction-row list rendered inside each
 * suggestion category.
 *
 * Exported: window.TransactionRows
 * Loaded (plain <script>) BEFORE ManualEventMatchModal.js.
 */

/* global React */

// Helper component: Transaction rows table
const TransactionRows = ({ transactions, selected, onSelect }) => {
  const fmt = (v) => v == null ? '—' : String(v);
  const fmtDate = (v) => {
    if (!v) return '—';
    try {
      return new Date(v).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    } catch {
      return String(v);
    }
  };
  const fmtMoney = (v) => v == null ? '—' : `$${Number(v).toFixed(2)}`;

  return React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: 8 } },
    transactions.map(txn =>
      React.createElement('div', {
        key: txn.MessageId,
        onClick: () => onSelect(txn),
        style: {
          padding: 10, borderRadius: 4, border: selected?.MessageId === txn.MessageId ? '2px solid #4a9eff' : '1px solid #ccc',
          background: selected?.MessageId === txn.MessageId ? 'rgba(74, 158, 255, 0.15)' : 'transparent',
          cursor: 'pointer', transition: 'all 150ms', fontSize: 12,
        }
      },
        selected?.MessageId === txn.MessageId && React.createElement('div', {
          style: { fontSize: 11, color: '#4a9eff', fontWeight: 600, marginBottom: 6 }
        }, '✓ Selected'),
        React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', fontWeight: 500 } },
          React.createElement('span', null, fmtMoney(txn.Amount)),
          React.createElement('span', { style: { color: 'var(--text2)' } }, fmtDate(txn.TimeStamp))
        ),
        React.createElement('div', { style: { color: 'var(--text2)', marginTop: 4, wordBreak: 'break-word' } },
          `${txn.Sender || '—'}`
        ),
        txn.Memo && React.createElement('div', {
          style: { color: 'var(--text2)', marginTop: 4, fontSize: 11, fontStyle: 'italic' }
        }, `"${String(txn.Memo).substring(0, 60)}..."`),
      )
    )
  );
};

// Export for use in ManualEventMatchModal
window.TransactionRows = TransactionRows;
