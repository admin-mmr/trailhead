/**
 * PaymentsPanel — React component for the Payments tab in mmr-admin.
 *
 * 2-step async payment workflow:
 *   1. View pending webapp_events + unmatched gmail_transactions
 *   2. Match (manual or auto) → Approve → Category-specific fulfillment
 *
 * Loaded as a <script> in index.html, uses the global `api()` helper.
 */

/* global React, api */
const { useState, useEffect, useCallback } = React;

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

const PendingEventsTable = ({ events, selectedEventId, onSelect, onViewMember }) => {
  if (!events.length) {
    return React.createElement('div', { className: 'empty', style: { padding: 24, textAlign: 'center' } },
      React.createElement('div', { className: 'big' }, '✓'),
      'No pending events'
    );
  }

  return React.createElement('table', { className: 'data-table' },
    React.createElement('thead', null,
      React.createElement('tr', null,
        React.createElement('th', null, ''),
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
            background: selectedEventId === ev.EventID ? 'var(--surface2)' : undefined,
          },
          onClick: () => onSelect(ev.EventID === selectedEventId ? null : ev.EventID),
        },
          React.createElement('td', null,
            React.createElement('input', {
              type: 'radio', checked: selectedEventId === ev.EventID,
              onChange: () => onSelect(ev.EventID),
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

const UnmatchedGmailTable = ({ rows, selectedMessageId, onSelect }) => {
  if (!rows.length) {
    return React.createElement('div', { className: 'empty', style: { padding: 24, textAlign: 'center' } },
      React.createElement('div', { className: 'big' }, '✓'),
      'No unmatched gmail transactions'
    );
  }

  return React.createElement('table', { className: 'data-table' },
    React.createElement('thead', null,
      React.createElement('tr', null,
        React.createElement('th', null, ''),
        React.createElement('th', null, 'Sender'),
        React.createElement('th', null, 'Amount'),
        React.createElement('th', null, 'Memo'),
        React.createElement('th', null, 'Tx Date'),
        React.createElement('th', null, 'Tx #'),
      )
    ),
    React.createElement('tbody', null,
      rows.map(g =>
        React.createElement('tr', {
          key: g.MessageId,
          style: {
            cursor: 'pointer',
            background: selectedMessageId === g.MessageId ? 'var(--surface2)' : undefined,
          },
          onClick: () => onSelect(g.MessageId === selectedMessageId ? null : g.MessageId),
        },
          React.createElement('td', null,
            React.createElement('input', {
              type: 'radio', checked: selectedMessageId === g.MessageId,
              onChange: () => onSelect(g.MessageId),
            })
          ),
          React.createElement('td', null, fmt(g.Sender)),
          React.createElement('td', null, fmtMoney(g.Amount)),
          React.createElement('td', { style: { maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, fmt(g.Memo)),
          React.createElement('td', null, fmtDate(g.TransactionDate)),
          React.createElement('td', { style: { fontSize: 11, fontFamily: 'monospace' } }, fmt(g.TransactionNumber)?.slice(-8)),
        )
      )
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

  // Selection state
  const [selectedEventId, setSelectedEventId] = useState(null);
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

  const handleManualMatch = async () => {
    if (!selectedEventId || !selectedMessageId) {
      showToast('Select one event AND one gmail transaction to match');
      return;
    }
    setLoading(true);
    const r = await api('/api/payments/manual-match', {
      method: 'POST',
      body: JSON.stringify({ eventId: selectedEventId, messageId: selectedMessageId }),
    });
    setLoading(false);
    if (r.ok) {
      showToast(`Matched: ${selectedEventId} ↔ ${selectedMessageId}`);
      setSelectedEventId(null);
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

  const handleApprove = async (eventId) => {
    const eid = eventId || selectedEventId;
    if (!eid) { showToast('Select an event to approve'); return; }
    setLoading(true);
    const r = await api(`/api/payments/approve/${eid}`, { method: 'POST', body: '{}' });
    setLoading(false);
    if (r.ok) {
      showToast(`Approved! Updated members: ${(r.updated_members || []).join(', ')}`);
      setSelectedEventId(null);
      loadAll();
    } else {
      showToast(`Error: ${r.error}`);
    }
  };

  const handleReject = async () => {
    if (!selectedEventId) { showToast('Select an event to reject'); return; }
    if (!rejectNotes.trim()) { showToast('Rejection reason required'); return; }
    setLoading(true);
    const r = await api(`/api/payments/reject/${selectedEventId}`, {
      method: 'POST',
      body: JSON.stringify({ notes: rejectNotes }),
    });
    setLoading(false);
    if (r.ok) {
      showToast(`Rejected: ${selectedEventId}`);
      setSelectedEventId(null);
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

  // Find selected event/gmail for display
  const selEvent = pendingEvents.find(e => e.EventID === selectedEventId);
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
          disabled: loading || !selectedEventId || !selectedMessageId,
        }, '🔗 Manual Match'),
        e('button', {
          className: 'btn btn-orange',
          onClick: handleAutoMatch,
          disabled: loading,
        }, '⚡ Auto-Match All'),
        selEvent && selEvent.Status === 'matched' && e('button', {
          className: 'btn btn-green',
          onClick: () => handleApprove(),
          disabled: loading,
        }, '✓ Approve Selected'),
        selEvent && e('button', {
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
      (selectedEventId || selectedMessageId) && e('div', {
        style: {
          padding: '8px 12px', marginBottom: 12, fontSize: 12,
          background: 'var(--surface)', borderRadius: 'var(--radius)',
          border: '1px solid var(--border)',
        }
      },
        selectedEventId && e('span', null, `Event: `, e('strong', null, selectedEventId.slice(0, 20)), '  '),
        selEvent && selEvent.Status === 'matched' && e('span', { style: { color: 'var(--accent)' } }, '[ready to approve] '),
        selectedMessageId && e('span', null, `Gmail: `, e('strong', null, selectedMessageId.slice(0, 16))),
      ),

      // Two-panel layout
      e('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 } },
        // Left: Pending Events
        e('div', null,
          e('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 } },
            e('h3', { style: { fontSize: 14 } }, `Pending Events (${pendingEvents.length})`),
            e('input', {
              placeholder: 'Search events...',
              value: searchEvents,
              onChange: ev => setSearchEvents(ev.target.value),
              style: {
                background: 'var(--surface)', border: '1px solid var(--border)',
                color: 'var(--text)', padding: '4px 8px', borderRadius: 'var(--radius)',
                fontSize: 12, width: 160,
              },
            }),
          ),
          e('div', { style: { maxHeight: 400, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 'var(--radius)' } },
            e(PendingEventsTable, {
              events: pendingEvents,
              selectedEventId,
              onSelect: setSelectedEventId,
              onViewMember: setMemberPopup,
            }),
          ),
        ),

        // Right: Unmatched Gmail
        e('div', null,
          e('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 } },
            e('h3', { style: { fontSize: 14 } }, `Unmatched Gmail (${unmatchedGmail.length})`),
            e('input', {
              placeholder: 'Search gmail...',
              value: searchGmail,
              onChange: ev => setSearchGmail(ev.target.value),
              style: {
                background: 'var(--surface)', border: '1px solid var(--border)',
                color: 'var(--text)', padding: '4px 8px', borderRadius: 'var(--radius)',
                fontSize: 12, width: 160,
              },
            }),
          ),
          e('div', { style: { maxHeight: 400, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 'var(--radius)' } },
            e(UnmatchedGmailTable, {
              rows: unmatchedGmail,
              selectedMessageId,
              onSelect: setSelectedMessageId,
            }),
          ),
          // "Create payment" shortcut for unmatched gmail
          selGmail && e('div', { style: { marginTop: 8 } },
            e('button', {
              className: 'btn btn-sm btn-outline',
              onClick: () => handleAdminCreate(selGmail),
            }, '+ Create Payment from Selected Gmail'),
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
