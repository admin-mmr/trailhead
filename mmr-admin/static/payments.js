/**
 * PaymentsPanel — React component for the Payments tab in mmr-admin.
 *
 * 2-step async payment workflow:
 *   1. View pending webapp_events + unmatched gmail_transactions
 *   2. Match (manual or auto) → Approve → Category-specific fulfillment
 *
 * Loaded as a <script> in index.html, uses the global `api()` helper.
 */

/* global React, api, useState, useEffect, useCallback, useRef */

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const fmt = (v) => v == null ? '—' : String(v);
const fmtDate = (v) => {
  if (!v) return '—';
  try { return new Date(v).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); }
  catch { return String(v); }
};
const fmtMoney = (v) => v == null ? '—' : `$${Number(v).toFixed(2)}`;

const STATUS_COLORS = {
  pending:  'var(--yellow)',
  matched:  'var(--accent)',
  approved: 'var(--green)',
  rejected: 'var(--red)',
  expired:  'var(--text2)',
  error:    'var(--red)',
};

const Badge = ({ status }) => (
  React.createElement('span', {
    style: {
      display: 'inline-block', padding: '2px 8px', borderRadius: 4, fontSize: 11,
      fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5,
      background: (STATUS_COLORS[status] || 'var(--text2)') + '22',
      color: STATUS_COLORS[status] || 'var(--text2)',
      border: `1px solid ${STATUS_COLORS[status] || 'var(--text2)'}44`,
    }
  }, status)
);

// ---------------------------------------------------------------------------
// Memo → MemberID extraction
// ---------------------------------------------------------------------------

/** Extract all MemberIDs ([Aa][0-9]{4}) found in a memo string. */
function extractMemberIds(text) {
  if (!text) return [];
  const matches = [...String(text).matchAll(/\b([Aa]\d{4})\b/g)];
  const unique = [...new Set(matches.map(m => m[1].toUpperCase()))];
  return unique;
}

/** Suggest payment intent based on amount. */
function suggestIntent(amount) {
  const n = Number(amount) || 0;
  if (n >= 50) return 'Family Membership';
  if (n >= 30) return 'Individual Membership';
  return 'Individual Membership';
}

const PAYMENT_INTENTS = [
  'Individual Membership',
  'Family Membership',
  'Family Upgrade',
  'Event Registration',
  'Donation',
];


// ---------------------------------------------------------------------------
// Gmail Quick-Approve Popover
// Shown inline when a Gmail row is clicked and memo contains a MemberID.
// ---------------------------------------------------------------------------

const GmailQuickApprovePopover = ({ gmail, onClose, onApproved }) => {
  const memoIds = extractMemberIds((gmail.Memo || '') + ' ' + (gmail.OriginalMemo || ''));
  const [memberId, setMemberId] = useState(memoIds[0] || '');
  const [intent, setIntent] = useState(suggestIntent(gmail.Amount));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const e = React.createElement;

  const handleApprove = async () => {
    const mid = memberId.trim().toUpperCase();
    if (!mid) { setError('MemberID required'); return; }
    if (!/^A\d{4}$/.test(mid)) { setError('MemberID must be A followed by 4 digits (e.g. A0123)'); return; }
    setLoading(true);
    setError('');
    const r = await api('/api/payments/admin-create', {
      method: 'POST',
      body: JSON.stringify({
        memberId: mid,
        messageId: gmail.MessageId,
        paymentIntent: intent,
        notes: `Quick-approved from unmatched Gmail. Memo: ${gmail.Memo || ''}`,
      }),
    });
    setLoading(false);
    if (r.ok) {
      onApproved(mid, intent);
    } else {
      setError(r.error || 'Failed to approve');
    }
  };

  return e('div', {
    style: {
      position: 'absolute', zIndex: 50, top: '100%', left: 0,
      background: 'var(--surface)', border: '1px solid var(--accent)',
      borderRadius: 'var(--radius)', padding: 16, minWidth: 340,
      boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
    },
    onClick: ev => ev.stopPropagation(),
  },
    e('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 } },
      e('strong', { style: { fontSize: 13 } }, '⚡ Quick Approve Payment'),
      e('button', {
        onClick: onClose,
        style: { background: 'none', border: 'none', color: 'var(--text2)', cursor: 'pointer', fontSize: 16, lineHeight: 1 },
      }, '✕'),
    ),

    // Gmail summary
    e('div', { style: { fontSize: 12, color: 'var(--text2)', marginBottom: 12, padding: '8px 10px', background: 'var(--bg)', borderRadius: 4 } },
      e('div', null, `Sender: ${gmail.Sender || '—'}`),
      e('div', null, `Amount: ${fmtMoney(gmail.Amount)}  ·  Date: ${fmtDate(gmail.TransactionDate)}`),
      e('div', { style: { wordBreak: 'break-all' } }, `Memo: ${gmail.Memo || '—'}`),
    ),

    // MemberID — dropdown if extracted, text input fallback
    e('div', { style: { marginBottom: 8 } },
      e('label', { style: { fontSize: 12, color: 'var(--text2)', display: 'block', marginBottom: 4 } }, 'Member ID'),
      memoIds.length > 0
        ? e('select', {
            value: memberId,
            onChange: ev => setMemberId(ev.target.value),
            style: { width: '100%', background: 'var(--bg)', border: '1px solid var(--border)', color: 'var(--text)', padding: '6px 8px', borderRadius: 'var(--radius)', fontSize: 13 },
          },
          memoIds.map(id => e('option', { key: id, value: id }, id)),
          e('option', { value: '' }, '— Enter manually —'),
          memberId === '' ? e('option', { value: '__custom__', disabled: true }, '') : null,
        )
        : null,
      (memoIds.length === 0 || memberId === '') && e('input', {
        placeholder: 'e.g. A0123',
        value: memoIds.length === 0 ? memberId : '',
        onChange: ev => setMemberId(ev.target.value),
        style: { width: '100%', marginTop: memoIds.length > 0 ? 6 : 0, background: 'var(--bg)', border: '1px solid var(--border)', color: 'var(--text)', padding: '6px 8px', borderRadius: 'var(--radius)', fontSize: 13, boxSizing: 'border-box' },
      }),
    ),

    // Payment intent
    e('div', { style: { marginBottom: 12 } },
      e('label', { style: { fontSize: 12, color: 'var(--text2)', display: 'block', marginBottom: 4 } }, 'Payment Type'),
      e('select', {
        value: intent,
        onChange: ev => setIntent(ev.target.value),
        style: { width: '100%', background: 'var(--bg)', border: '1px solid var(--border)', color: 'var(--text)', padding: '6px 8px', borderRadius: 'var(--radius)', fontSize: 13 },
      },
        PAYMENT_INTENTS.map(opt => e('option', { key: opt, value: opt }, opt)),
      ),
    ),

    error && e('div', { style: { color: 'var(--red)', fontSize: 12, marginBottom: 8 } }, error),

    e('button', {
      className: 'btn btn-green',
      onClick: handleApprove,
      disabled: loading,
      style: { width: '100%' },
    }, loading ? 'Processing…' : `✓ Approve as ${intent}`),
  );
};


// ---------------------------------------------------------------------------
// Stats cards
// ---------------------------------------------------------------------------

const StatsCards = ({ stats }) => {
  const cards = [
    { label: 'Pending', value: stats.pending || 0, cls: 'yellow' },
    { label: 'Matched', value: stats.matched || 0, cls: 'accent' },
    { label: 'Unmatched Gmail', value: stats.unmatched_gmail || 0, cls: 'red' },
    { label: 'Approved (30d)', value: stats.approved_30d || 0, cls: 'green' },
    { label: 'Rejected (30d)', value: stats.rejected_30d || 0, cls: '' },
    { label: 'Errors', value: stats.errors || 0, cls: stats.errors > 0 ? 'red' : '' },
  ];
  return React.createElement('div', { className: 'stats-grid' },
    cards.map((c, i) =>
      React.createElement('div', { className: 'stat-card', key: i },
        React.createElement('div', { className: 'label' }, c.label),
        React.createElement('div', { className: `value ${c.cls}` }, c.value),
      )
    )
  );
};


// ---------------------------------------------------------------------------
// Member detail popup
// ---------------------------------------------------------------------------

const MemberPopup = ({ memberId, onClose }) => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!memberId) return;
    setLoading(true);
    api(`/api/payments/member/${memberId}`).then(r => {
      if (r.ok) setData(r.data);
      setLoading(false);
    });
  }, [memberId]);

  if (!memberId) return null;

  const overlay = {
    position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
    background: 'rgba(0,0,0,0.6)', zIndex: 100,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  };
  const panel = {
    background: 'var(--surface)', borderRadius: 'var(--radius)', padding: 24,
    maxWidth: 600, width: '90%', maxHeight: '80vh', overflowY: 'auto',
  };

  return React.createElement('div', { style: overlay, onClick: onClose },
    React.createElement('div', { style: panel, onClick: e => e.stopPropagation() },
      loading
        ? React.createElement('div', { className: 'loading' }, 'Loading...')
        : !data
          ? React.createElement('div', null, 'Member not found')
          : React.createElement(React.Fragment, null,
              React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', marginBottom: 16 } },
                React.createElement('h3', null, `${data.member.FirstName} ${data.member.LastName} (${memberId})`),
                React.createElement('button', { className: 'btn btn-sm btn-outline', onClick: onClose }, '✕'),
              ),
              React.createElement('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 16, fontSize: 13 } },
                React.createElement('div', null, React.createElement('span', { style: { color: 'var(--text2)' } }, 'Email: '), data.member.Email),
                React.createElement('div', null, React.createElement('span', { style: { color: 'var(--text2)' } }, 'Type: '), data.member.Type),
                React.createElement('div', null, React.createElement('span', { style: { color: 'var(--text2)' } }, 'Status: '), data.member.Status),
                React.createElement('div', null, React.createElement('span', { style: { color: 'var(--text2)' } }, 'Expiration: '), fmtDate(data.member.Expiration)),
                React.createElement('div', null, React.createElement('span', { style: { color: 'var(--text2)' } }, 'FamilyID: '), fmt(data.member.FamilyID)),
              ),
              data.family_members.length > 0 && React.createElement(React.Fragment, null,
                React.createElement('h4', { style: { marginBottom: 8, marginTop: 12 } }, 'Family Members'),
                React.createElement('table', { className: 'data-table', style: { fontSize: 12 } },
                  React.createElement('thead', null,
                    React.createElement('tr', null, ['ID','Name','Email','Type','Expiration'].map(h =>
                      React.createElement('th', { key: h }, h)
                    ))
                  ),
                  React.createElement('tbody', null,
                    data.family_members.map(fm =>
                      React.createElement('tr', { key: fm.MemberID },
                        React.createElement('td', null, fm.MemberID),
                        React.createElement('td', null, `${fm.FirstName} ${fm.LastName}`),
                        React.createElement('td', null, fm.Email),
                        React.createElement('td', null, fm.Type),
                        React.createElement('td', null, fmtDate(fm.Expiration)),
                      )
                    )
                  )
                )
              ),
              data.recent_payments.length > 0 && React.createElement(React.Fragment, null,
                React.createElement('h4', { style: { marginBottom: 8, marginTop: 12 } }, 'Recent Payments'),
                React.createElement('table', { className: 'data-table', style: { fontSize: 12 } },
                  React.createElement('thead', null,
                    React.createElement('tr', null, ['Date','Amount','Intent','Source'].map(h =>
                      React.createElement('th', { key: h }, h)
                    ))
                  ),
                  React.createElement('tbody', null,
                    data.recent_payments.map(p =>
                      React.createElement('tr', { key: p.PaymentID },
                        React.createElement('td', null, fmtDate(p.PaymentDate)),
                        React.createElement('td', null, fmtMoney(p.Amount)),
                        React.createElement('td', null, fmt(p.PaymentIntent)),
                        React.createElement('td', null, fmt(p.Source)),
                      )
                    )
                  )
                )
              ),
            )
    )
  );
};


// ---------------------------------------------------------------------------
// Pending events table
// ---------------------------------------------------------------------------

const PendingEventsTable = ({ events, selectedEventIds, onToggle, onSelectAll, onViewMember }) => {
  if (!events.length) {
    return React.createElement('div', { className: 'empty', style: { padding: 24, textAlign: 'center' } },
      React.createElement('div', { className: 'big' }, '✓'),
      'No pending events'
    );
  }

  const allChecked = events.length > 0 && events.every(ev => selectedEventIds.has(ev.EventID));
  const someChecked = events.some(ev => selectedEventIds.has(ev.EventID));

  return React.createElement('table', { className: 'data-table' },
    React.createElement('thead', null,
      React.createElement('tr', null,
        React.createElement('th', null,
          React.createElement('input', {
            type: 'checkbox',
            checked: allChecked,
            ref: el => { if (el) el.indeterminate = someChecked && !allChecked; },
            onChange: () => onSelectAll(allChecked ? [] : events.map(ev => ev.EventID)),
            title: allChecked ? 'Deselect all' : 'Select all',
          })
        ),
        React.createElement('th', null, 'Event ID'),
        React.createElement('th', null, 'Member'),
        React.createElement('th', null, 'Intent'),
        React.createElement('th', null, 'Amount'),
        React.createElement('th', null, 'Method'),
        React.createElement('th', null, 'Payer'),
        React.createElement('th', null, 'Status'),
        React.createElement('th', null, 'Submitted'),
      )
    ),
    React.createElement('tbody', null,
      events.map(ev =>
        React.createElement('tr', {
          key: ev.EventID,
          style: {
            cursor: 'pointer',
            background: selectedEventIds.has(ev.EventID) ? 'var(--surface2)' : undefined,
          },
          onClick: () => onToggle(ev.EventID),
        },
          React.createElement('td', { onClick: e => e.stopPropagation() },
            React.createElement('input', {
              type: 'checkbox', checked: selectedEventIds.has(ev.EventID),
              onChange: () => onToggle(ev.EventID),
            })
          ),
          React.createElement('td', { style: { fontSize: 11, fontFamily: 'monospace' } }, ev.EventID?.slice(0, 20)),
          React.createElement('td', null,
            React.createElement('span', {
              style: { cursor: 'pointer', color: 'var(--accent)' },
              onClick: (e) => { e.stopPropagation(); onViewMember(ev.MemberID); },
            }, ev.MemberID),
            ev.FirstName ? React.createElement('span', { style: { color: 'var(--text2)', marginLeft: 4, fontSize: 12 } }, `${ev.FirstName} ${ev.LastName}`) : null,
          ),
          React.createElement('td', null, fmt(ev.PaymentIntent)),
          React.createElement('td', null, fmtMoney(ev.Amount)),
          React.createElement('td', null, fmt(ev.PaymentMethod)),
          React.createElement('td', null, fmt(ev.PayerName)),
          React.createElement('td', null, React.createElement(Badge, { status: ev.Status })),
          React.createElement('td', null, fmtDate(ev.Timestamp)),
        )
      )
    )
  );
};


// ---------------------------------------------------------------------------
// Unmatched gmail table
// ---------------------------------------------------------------------------

const UnmatchedGmailTable = ({ rows, selectedMessageId, onSelect, onQuickApproved }) => {
  const [activePopover, setActivePopover] = useState(null); // MessageId of open popover
  const e = React.createElement;

  if (!rows.length) {
    return e('div', { className: 'empty', style: { padding: 24, textAlign: 'center' } },
      e('div', { className: 'big' }, '✓'),
      'No unmatched Gmail transactions'
    );
  }

  return e('table', { className: 'data-table' },
    e('thead', null,
      e('tr', null,
        e('th', null, ''),
        e('th', null, 'Sender'),
        e('th', null, 'Amount'),
        e('th', null, 'Memo'),
        e('th', null, 'Tx Date'),
        e('th', null, 'Tx #'),
        e('th', null, ''),  // quick-action column
      )
    ),
    e('tbody', null,
      rows.map(g => {
        const memoIds = extractMemberIds((g.Memo || '') + ' ' + (g.OriginalMemo || ''));
        const hasMemoId = memoIds.length > 0;
        const isOpen = activePopover === g.MessageId;

        return e('tr', {
          key: g.MessageId,
          style: {
            cursor: 'pointer',
            background: selectedMessageId === g.MessageId ? 'var(--surface2)' : undefined,
          },
          onClick: () => { onSelect(g.MessageId === selectedMessageId ? null : g.MessageId); },
        },
          e('td', null,
            e('input', {
              type: 'radio', checked: selectedMessageId === g.MessageId,
              onChange: () => onSelect(g.MessageId),
              onClick: ev => ev.stopPropagation(),
            })
          ),
          e('td', null, fmt(g.Sender)),
          e('td', null, fmtMoney(g.Amount)),
          e('td', { style: { maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } },
            hasMemoId
              ? e('span', null,
                  e('span', {
                    style: {
                      display: 'inline-block', background: 'var(--accent)22', color: 'var(--accent)',
                      border: '1px solid var(--accent)44', borderRadius: 3, padding: '1px 5px',
                      fontSize: 11, fontWeight: 600, marginRight: 4, cursor: 'default',
                    },
                    title: `MemberID found: ${memoIds.join(', ')}`,
                  }, memoIds[0]),
                  e('span', { style: { color: 'var(--text2)' } }, fmt(g.Memo)),
                )
              : fmt(g.Memo),
          ),
          e('td', null, fmtDate(g.TransactionDate)),
          e('td', { style: { fontSize: 11, fontFamily: 'monospace' } }, fmt(g.TransactionNumber)?.slice(-8)),
          // Quick-approve button + popover
          e('td', { style: { position: 'relative', whiteSpace: 'nowrap' }, onClick: ev => ev.stopPropagation() },
            e('button', {
              className: `btn btn-sm ${hasMemoId ? 'btn-green' : 'btn-outline'}`,
              style: { fontSize: 11, padding: '2px 8px' },
              title: hasMemoId
                ? `Quick-approve for ${memoIds.join(', ')}`
                : 'Create payment for any member',
              onClick: ev => {
                ev.stopPropagation();
                setActivePopover(isOpen ? null : g.MessageId);
              },
            }, hasMemoId ? '⚡ Quick' : '+ Create'),
            isOpen && e(GmailQuickApprovePopover, {
              gmail: g,
              onClose: () => setActivePopover(null),
              onApproved: (mid, intent) => {
                setActivePopover(null);
                onQuickApproved(g.MessageId, mid, intent);
              },
            }),
          ),
        );
      })
    )
  );
};


// ---------------------------------------------------------------------------
// Payment history table
// ---------------------------------------------------------------------------

const PaymentHistoryTable = ({ payments }) => {
  if (!payments.length) {
    return React.createElement('div', { className: 'empty', style: { padding: 16, textAlign: 'center' } }, 'No recent payments');
  }
  return React.createElement('table', { className: 'data-table', style: { fontSize: 12 } },
    React.createElement('thead', null,
      React.createElement('tr', null,
        ['Date','Member','Name','Amount','Intent','Type','Source','Processed By'].map(h =>
          React.createElement('th', { key: h }, h)
        )
      )
    ),
    React.createElement('tbody', null,
      payments.map(p =>
        React.createElement('tr', { key: p.PaymentID },
          React.createElement('td', null, fmtDate(p.PaymentDate)),
          React.createElement('td', null, fmt(p.MemberID)),
          React.createElement('td', null, p.FirstName ? `${p.FirstName} ${p.LastName}` : '—'),
          React.createElement('td', null, fmtMoney(p.Amount)),
          React.createElement('td', null, fmt(p.PaymentIntent)),
          React.createElement('td', null, fmt(p.MembershipType)),
          React.createElement('td', null, fmt(p.Source)),
          React.createElement('td', null, fmt(p.ProcessedBy)),
        )
      )
    )
  );
};


// ---------------------------------------------------------------------------
// Admin-create payment modal
// ---------------------------------------------------------------------------

const AdminCreateModal = ({ messageId, gmail, onClose, onCreated }) => {
  const [memberId, setMemberId] = useState('');
  const [intent, setIntent] = useState('Individual Membership');
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleCreate = async () => {
    if (!memberId.trim()) { setError('MemberID required'); return; }
    setLoading(true);
    setError('');
    const r = await api('/api/payments/admin-create', {
      method: 'POST',
      body: JSON.stringify({ memberId: memberId.trim(), messageId, paymentIntent: intent, notes }),
    });
    setLoading(false);
    if (r.ok) { onCreated(r); }
    else { setError(r.error || 'Failed'); }
  };

  const overlay = {
    position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
    background: 'rgba(0,0,0,0.6)', zIndex: 100,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  };
  const panel = {
    background: 'var(--surface)', borderRadius: 'var(--radius)', padding: 24,
    maxWidth: 480, width: '90%',
  };

  return React.createElement('div', { style: overlay, onClick: onClose },
    React.createElement('div', { style: panel, onClick: e => e.stopPropagation() },
      React.createElement('h3', { style: { marginBottom: 12 } }, 'Create Payment from Gmail'),
      gmail && React.createElement('div', { style: { fontSize: 12, color: 'var(--text2)', marginBottom: 12, padding: 8, background: 'var(--bg)', borderRadius: 4 } },
        React.createElement('div', null, `Sender: ${gmail.Sender}`),
        React.createElement('div', null, `Amount: ${fmtMoney(gmail.Amount)}`),
        React.createElement('div', null, `Memo: ${gmail.Memo || '—'}`),
        React.createElement('div', null, `Date: ${fmtDate(gmail.TransactionDate)}`),
      ),
      React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12 } },
        React.createElement('input', {
          placeholder: 'MemberID (e.g. A0123)',
          value: memberId, onChange: e => setMemberId(e.target.value),
          style: { background: 'var(--bg)', border: '1px solid var(--border)', color: 'var(--text)', padding: '8px 12px', borderRadius: 'var(--radius)' },
        }),
        React.createElement('select', {
          value: intent, onChange: e => setIntent(e.target.value),
          style: { background: 'var(--bg)', border: '1px solid var(--border)', color: 'var(--text)', padding: '8px 12px', borderRadius: 'var(--radius)' },
        },
          React.createElement('option', { value: 'Individual Membership' }, 'Individual Membership'),
          React.createElement('option', { value: 'Family Membership' }, 'Family Membership'),
          React.createElement('option', { value: 'Family Upgrade' }, 'Family Upgrade'),
          React.createElement('option', { value: 'Event Registration' }, 'Event Registration'),
          React.createElement('option', { value: 'Donation' }, 'Donation'),
        ),
        React.createElement('input', {
          placeholder: 'Notes (optional)',
          value: notes, onChange: e => setNotes(e.target.value),
          style: { background: 'var(--bg)', border: '1px solid var(--border)', color: 'var(--text)', padding: '8px 12px', borderRadius: 'var(--radius)' },
        }),
      ),
      error && React.createElement('div', { style: { color: 'var(--red)', fontSize: 12, marginBottom: 8 } }, error),
      React.createElement('div', { style: { display: 'flex', gap: 8, justifyContent: 'flex-end' } },
        React.createElement('button', { className: 'btn btn-outline', onClick: onClose }, 'Cancel'),
        React.createElement('button', { className: 'btn btn-green', onClick: handleCreate, disabled: loading },
          loading ? 'Creating...' : 'Create & Approve'
        ),
      ),
    )
  );
};


// ---------------------------------------------------------------------------
// Main PaymentsPanel component
// ---------------------------------------------------------------------------

const PaymentsPanel = () => {
  // Data
  const [stats, setStats] = useState({});
  const [pendingEvents, setPendingEvents] = useState([]);
  const [unmatchedGmail, setUnmatchedGmail] = useState([]);
  const [history, setHistory] = useState([]);

  // Selection state — events support multi-select; gmail stays single
  const [selectedEventIds, setSelectedEventIds] = useState(new Set());
  const [selectedMessageId, setSelectedMessageId] = useState(null);

  // UI state
  const [subView, setSubView] = useState('reconcile'); // reconcile | history
  const [searchEvents, setSearchEvents] = useState('');
  const [searchGmail, setSearchGmail] = useState('');
  const [toast, setToast] = useState('');
  const [loading, setLoading] = useState(false);
  const [memberPopup, setMemberPopup] = useState(null);
  const [adminCreateGmail, setAdminCreateGmail] = useState(null);
  const [rejectNotes, setRejectNotes] = useState('');
  const [showRejectInput, setShowRejectInput] = useState(false);
  const [showPending, setShowPending] = useState(false); // collapsed by default

  // ---- Data loading ----

  const loadAll = useCallback(() => {
    api('/api/payments/dashboard').then(r => r.ok && setStats(r.data));
    api(`/api/payments/pending-events?q=${encodeURIComponent(searchEvents)}`).then(r => r.ok && setPendingEvents(r.data));
    api(`/api/payments/unmatched-gmail?q=${encodeURIComponent(searchGmail)}`).then(r => r.ok && setUnmatchedGmail(r.data));
  }, [searchEvents, searchGmail]);

  const loadHistory = useCallback(() => {
    api('/api/payments/history').then(r => r.ok && setHistory(r.data));
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);
  useEffect(() => { if (subView === 'history') loadHistory(); }, [subView, loadHistory]);

  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(''), 4000); };

  // ---- Actions ----

  // Helpers for multi-select
  const toggleEvent = (id) => setSelectedEventIds(prev => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });
  const selectAllEvents = (ids) => setSelectedEventIds(new Set(ids));

  // For actions that need exactly one event selected (reject, manual match)
  const singleSelectedId = selectedEventIds.size === 1 ? [...selectedEventIds][0] : null;
  const selEvent = singleSelectedId ? pendingEvents.find(e => e.EventID === singleSelectedId) : null;

  const handleManualMatch = async () => {
    if (!singleSelectedId || !selectedMessageId) {
      showToast('Select exactly one event AND one gmail transaction to match');
      return;
    }
    setLoading(true);
    const r = await api('/api/payments/manual-match', {
      method: 'POST',
      body: JSON.stringify({ eventId: singleSelectedId, messageId: selectedMessageId }),
    });
    setLoading(false);
    if (r.ok) {
      showToast(`Matched: ${singleSelectedId} ↔ ${selectedMessageId}`);
      setSelectedEventIds(new Set());
      setSelectedMessageId(null);
      loadAll();
    } else {
      showToast(`Error: ${r.error}`);
    }
  };

  const handleAutoMatch = async () => {
    setLoading(true);
    const r = await api('/api/payments/auto-match', { method: 'POST' });
    setLoading(false);
    if (r.ok) {
      const s = r.data;
      showToast(`Auto-match: ${s.matched} matched, ${s.skipped} skipped, ${s.errors} errors`);
      loadAll();
    } else {
      showToast(`Error: ${r.error}`);
    }
  };

  const handleAutoGuessAndApprove = async () => {
    if (!confirm('Run Auto-Match then approve ALL matched events?\nThis will update member expirations and send renewal emails.')) return;
    setLoading(true);
    showToast('Step 1/2: Running auto-match…');

    // Step 1: auto-match pending events to gmail transactions
    const matchRes = await api('/api/payments/auto-match', { method: 'POST' });
    if (!matchRes.ok) {
      setLoading(false);
      showToast(`Auto-match failed: ${matchRes.error}`);
      return;
    }
    const { matched: newlyMatched } = matchRes.data;

    // Step 2: reload pending list, approve everything with status=matched
    const evRes = await api('/api/payments/pending-events');
    if (!evRes.ok) {
      setLoading(false);
      showToast(`Auto-match OK (${newlyMatched} matched) but failed to reload events`);
      return;
    }
    const allMatched = evRes.data.filter(ev => ev.Status === 'matched');
    if (!allMatched.length) {
      setLoading(false);
      showToast(`Auto-match: ${newlyMatched} newly matched, 0 events ready to approve`);
      loadAll();
      return;
    }

    showToast(`Step 2/2: Approving ${allMatched.length} matched event(s)…`);
    let approved = 0, failed = 0, failedIds = [];
    for (const ev of allMatched) {
      const r = await api(`/api/payments/approve/${ev.EventID}`, { method: 'POST', body: '{}' });
      if (r.ok) { approved++; }
      else { failed++; failedIds.push(ev.EventID.slice(0, 12)); }
    }
    setLoading(false);
    showToast(`Done! ${newlyMatched} matched → ${approved} approved${failed ? `, ${failed} failed: ${failedIds.join(', ')}` : ''}`);
    setSelectedEventIds(new Set());
    loadAll();
  };

  const handleApproveSelected = async () => {
    const ids = [...selectedEventIds];
    if (!ids.length) { showToast('Select at least one event to approve'); return; }
    setLoading(true);
    let approved = 0, failed = 0;
    for (const eid of ids) {
      const r = await api(`/api/payments/approve/${eid}`, { method: 'POST', body: '{}' });
      r.ok ? approved++ : failed++;
    }
    setLoading(false);
    showToast(`Approved ${approved}${failed ? `, ${failed} failed` : ''}`);
    setSelectedEventIds(new Set());
    loadAll();
  };

  const handleApproveAllMatched = async () => {
    const matchedIds = pendingEvents
      .filter(ev => ev.Status === 'matched')
      .map(ev => ev.EventID);
    if (!matchedIds.length) { showToast('No matched events to approve'); return; }
    if (!confirm(`Approve all ${matchedIds.length} matched event(s)?`)) return;
    setLoading(true);
    let approved = 0, failed = 0, failedIds = [];
    for (const eid of matchedIds) {
      const r = await api(`/api/payments/approve/${eid}`, { method: 'POST', body: '{}' });
      if (r.ok) { approved++; }
      else { failed++; failedIds.push(eid.slice(0, 12)); }
    }
    setLoading(false);
    showToast(`Approved ${approved}${failed ? ` — ${failed} failed: ${failedIds.join(', ')}` : ''}`);
    setSelectedEventIds(new Set());
    loadAll();
  };

  const handleReject = async () => {
    if (!singleSelectedId) { showToast('Select exactly one event to reject'); return; }
    if (!rejectNotes.trim()) { showToast('Rejection reason required'); return; }
    setLoading(true);
    const r = await api(`/api/payments/reject/${singleSelectedId}`, {
      method: 'POST',
      body: JSON.stringify({ notes: rejectNotes }),
    });
    setLoading(false);
    if (r.ok) {
      showToast(`Rejected: ${singleSelectedId}`);
      setSelectedEventIds(new Set());
      setShowRejectInput(false);
      setRejectNotes('');
      loadAll();
    } else {
      showToast(`Error: ${r.error}`);
    }
  };

  const handleAdminCreate = (gmail) => {
    setAdminCreateGmail(gmail);
  };

  const handleQuickApproved = (messageId, memberId, intent) => {
    showToast(`✓ Approved ${intent} for ${memberId}`);
    loadAll();
  };

  // Derived
  const matchedCount = pendingEvents.filter(ev => ev.Status === 'matched').length;
  const selectedMatchedCount = [...selectedEventIds].filter(id => {
    const ev = pendingEvents.find(e => e.EventID === id);
    return ev && ev.Status === 'matched';
  }).length;
  const selGmail = unmatchedGmail.find(g => g.MessageId === selectedMessageId);

  // ---- Render ----
  const e = React.createElement;

  return e('div', null,
    // Toast
    toast && e('div', {
      style: {
        position: 'fixed', top: 16, right: 16, zIndex: 200,
        background: 'var(--surface)', border: '1px solid var(--accent)',
        borderRadius: 'var(--radius)', padding: '10px 16px', fontSize: 13,
        boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
      }
    }, toast),

    // Member popup
    memberPopup && e(MemberPopup, { memberId: memberPopup, onClose: () => setMemberPopup(null) }),

    // Admin create modal
    adminCreateGmail && e(AdminCreateModal, {
      messageId: adminCreateGmail.MessageId,
      gmail: adminCreateGmail,
      onClose: () => setAdminCreateGmail(null),
      onCreated: (r) => {
        setAdminCreateGmail(null);
        showToast(`Payment created! Members updated: ${(r.updated_members || []).join(', ')}`);
        loadAll();
      },
    }),

    // Stats
    e(StatsCards, { stats }),

    // Sub-tabs
    e('div', { style: { display: 'flex', gap: 8, marginBottom: 16 } },
      e('button', {
        className: `btn ${subView === 'reconcile' ? 'btn-primary' : 'btn-outline'}`,
        onClick: () => setSubView('reconcile'),
      }, 'Reconcile'),
      e('button', {
        className: `btn ${subView === 'history' ? 'btn-primary' : 'btn-outline'}`,
        onClick: () => setSubView('history'),
      }, 'Payment History'),
    ),

    subView === 'reconcile' && e(React.Fragment, null,
      // Action bar
      e('div', { className: 'toolbar', style: { marginBottom: 16 } },
        e('button', {
          className: 'btn btn-primary',
          onClick: handleManualMatch,
          disabled: loading || !singleSelectedId || !selectedMessageId,
          title: 'Select exactly one event and one gmail row',
        }, '🔗 Manual Match'),
        e('button', {
          className: 'btn btn-orange',
          onClick: handleAutoMatch,
          disabled: loading,
        }, '⚡ Auto-Match All'),
        e('button', {
          className: 'btn btn-primary',
          onClick: handleAutoGuessAndApprove,
          disabled: loading,
          title: 'Auto-match all pending events then approve everything matched — updates expirations + sends emails',
          style: { background: 'var(--purple, #7c3aed)', borderColor: 'var(--purple, #7c3aed)' },
        }, '🚀 Auto-Guess & Approve All'),
        matchedCount > 0 && e('button', {
          className: 'btn btn-green',
          onClick: handleApproveAllMatched,
          disabled: loading,
        }, `✓ Approve All Matched (${matchedCount})`),
        selectedMatchedCount > 0 && e('button', {
          className: 'btn btn-green',
          onClick: handleApproveSelected,
          disabled: loading,
          style: { opacity: 0.85 },
        }, `✓ Approve Selected (${selectedMatchedCount})`),
        singleSelectedId && e('button', {
          className: 'btn btn-outline',
          onClick: () => setShowRejectInput(!showRejectInput),
          style: { color: 'var(--red)' },
        }, '✕ Reject'),
        showRejectInput && e(React.Fragment, null,
          e('input', {
            placeholder: 'Rejection reason...',
            value: rejectNotes,
            onChange: ev => setRejectNotes(ev.target.value),
            style: { minWidth: 200 },
          }),
          e('button', {
            className: 'btn btn-sm',
            style: { background: 'var(--red)', color: '#fff' },
            onClick: handleReject,
            disabled: loading,
          }, 'Confirm Reject'),
        ),
      ),

      // Selection summary
      (selectedEventIds.size > 0 || selectedMessageId) && e('div', {
        style: {
          padding: '8px 12px', marginBottom: 12, fontSize: 12,
          background: 'var(--surface)', borderRadius: 'var(--radius)',
          border: '1px solid var(--border)',
        }
      },
        selectedEventIds.size > 0 && e('span', null,
          `${selectedEventIds.size} event${selectedEventIds.size > 1 ? 's' : ''} selected`,
          selectedMatchedCount > 0
            ? e('span', { style: { color: 'var(--green)', marginLeft: 6 } }, `(${selectedMatchedCount} matched)`)
            : null,
          '  ',
        ),
        selectedMessageId && e('span', null, `Gmail: `, e('strong', null, selectedMessageId.slice(0, 16))),
      ),

      // Unmatched Gmail — full width, primary focus
      e('div', { style: { marginBottom: 16 } },
        e('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 } },
          e('h3', { style: { fontSize: 14 } },
            `Unmatched Gmail (${unmatchedGmail.length})`,
            unmatchedGmail.filter(g => extractMemberIds((g.Memo||'')+(g.OriginalMemo||'')).length > 0).length > 0 && e('span', {
              style: { marginLeft: 8, fontSize: 11, color: 'var(--green)', fontWeight: 400 },
            }, `· ${unmatchedGmail.filter(g => extractMemberIds((g.Memo||'')+(g.OriginalMemo||'')).length > 0).length} with MemberID ⚡`),
          ),
          e('div', { style: { display: 'flex', gap: 8, alignItems: 'center' } },
            e('input', {
              placeholder: 'Search gmail...',
              value: searchGmail,
              onChange: ev => setSearchGmail(ev.target.value),
              style: {
                background: 'var(--surface)', border: '1px solid var(--border)',
                color: 'var(--text)', padding: '4px 8px', borderRadius: 'var(--radius)',
                fontSize: 12, width: 180,
              },
            }),
          ),
        ),
        e('div', { style: { overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 'var(--radius)' } },
          e(UnmatchedGmailTable, {
            rows: unmatchedGmail,
            selectedMessageId,
            onSelect: setSelectedMessageId,
            onQuickApproved: handleQuickApproved,
          }),
        ),
        selGmail && e('div', { style: { marginTop: 8 } },
          e('button', {
            className: 'btn btn-sm btn-outline',
            onClick: () => handleAdminCreate(selGmail),
          }, '+ Create Payment from Selected Gmail'),
        ),
      ),

      // Pending Events — collapsible
      e('div', { style: { marginTop: 8 } },
        e('div', {
          style: {
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            padding: '8px 12px', background: 'var(--surface)', border: '1px solid var(--border)',
            borderRadius: showPending ? '6px 6px 0 0' : 'var(--radius)', cursor: 'pointer',
          },
          onClick: () => setShowPending(v => !v),
        },
          e('span', { style: { fontSize: 13, fontWeight: 600 } },
            `${showPending ? '▾' : '▸'} Pending Events (${pendingEvents.length})`,
            matchedCount > 0 && e('span', { style: { marginLeft: 8, color: 'var(--accent)', fontSize: 12 } },
              `· ${matchedCount} matched`
            ),
          ),
          e('span', { style: { fontSize: 11, color: 'var(--text2)' } },
            showPending ? 'click to collapse' : 'click to expand · use for manual match or reject'
          ),
        ),
        showPending && e('div', null,
          e('div', { style: { padding: '8px 12px', borderBottom: '1px solid var(--border)', background: 'var(--surface)', display: 'flex', justifyContent: 'flex-end' } },
            e('input', {
              placeholder: 'Search events...',
              value: searchEvents,
              onChange: ev => setSearchEvents(ev.target.value),
              style: {
                background: 'var(--bg)', border: '1px solid var(--border)',
                color: 'var(--text)', padding: '4px 8px', borderRadius: 'var(--radius)',
                fontSize: 12, width: 200,
              },
            }),
          ),
          e('div', { style: { maxHeight: 360, overflowY: 'auto', border: '1px solid var(--border)', borderTop: 'none', borderRadius: '0 0 6px 6px' } },
            e(PendingEventsTable, {
              events: pendingEvents,
              selectedEventIds,
              onToggle: toggleEvent,
              onSelectAll: selectAllEvents,
              onViewMember: setMemberPopup,
            }),
          ),
        ),
      ),
    ),

    // History sub-view
    subView === 'history' && e('div', null,
      e('h3', { style: { fontSize: 14, marginBottom: 12 } }, 'Payment History (Last 90 Days)'),
      e(PaymentHistoryTable, { payments: history }),
    ),
  );
};

// Export for use in index.html
window.PaymentsPanel = PaymentsPanel;
