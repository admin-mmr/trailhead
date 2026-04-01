/**
 * PaymentsPanel — React component for the Payments tab in mmr-admin.
 *
 * Layout: side-by-side reconcile view
 *   Left panel:  webapp_events (toggleable)
 *   Right panel: gmail_transactions (filtered when an event is focused)
 *
 * Features added:
 *   - MemberID hover tooltip (name, expiration, type, gender, district)
 *   - Event row focus → auto-filter gmail candidates incl. already-processed rows
 *   - Toggle events panel visibility (left ↔ full-width)
 *
 * Loaded as <script> in index.html; uses global `api()` helper and React globals.
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

const Badge = ({ status }) =>
  React.createElement('span', {
    style: {
      display: 'inline-block', padding: '2px 8px', borderRadius: 4, fontSize: 11,
      fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5,
      background: (STATUS_COLORS[status] || 'var(--text2)') + '22',
      color: STATUS_COLORS[status] || 'var(--text2)',
      border: `1px solid ${STATUS_COLORS[status] || 'var(--text2)'}44`,
    }
  }, status);


// ---------------------------------------------------------------------------
// Memo → MemberID extraction + intent suggestion
// ---------------------------------------------------------------------------

function extractMemberIds(text) {
  if (!text) return [];
  const matches = [...String(text).matchAll(/\b([Aa]\d{4})\b/g)];
  return [...new Set(matches.map(m => m[1].toUpperCase()))];
}

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
// Member tooltip cache + components
// ---------------------------------------------------------------------------

/** Module-level cache so tooltip data survives re-renders. */
const _memberCache = {};

/**
 * MemberTooltip — fixed-position hover card.
 * Rendered at PaymentsPanel level; anchored to the hovered chip's bounding rect.
 */
const MemberTooltip = ({ memberId, anchorRect, data }) => {
  if (!memberId || !anchorRect) return null;

  const TOOLTIP_WIDTH = 270;
  const TOOLTIP_HEIGHT = 160; // approximate
  const MARGIN = 6;
  const EDGE_PADDING = 8;

  // Horizontal: center-ish with bounds
  let left = anchorRect.left - TOOLTIP_WIDTH / 2 + anchorRect.width / 2;
  left = Math.max(EDGE_PADDING, Math.min(left, window.innerWidth - TOOLTIP_WIDTH - EDGE_PADDING));

  // Vertical: show below by default, above if not enough room
  let top = anchorRect.bottom + MARGIN;
  const spaceBelow = window.innerHeight - anchorRect.bottom;
  const spaceAbove = anchorRect.top;

  if (spaceBelow < TOOLTIP_HEIGHT + MARGIN && spaceAbove > TOOLTIP_HEIGHT + MARGIN) {
    // Show above
    top = anchorRect.top - TOOLTIP_HEIGHT - MARGIN;
  }

  return React.createElement('div', {
    style: {
      position: 'fixed', top, left, zIndex: 1000,
      background: 'var(--surface)', border: '1px solid var(--accent)',
      borderRadius: 8, padding: '10px 14px', fontSize: 12,
      boxShadow: '0 6px 24px rgba(0,0,0,0.5)', pointerEvents: 'none',
      minWidth: 200, maxWidth: 270,
    },
  },
    !data
      ? React.createElement('span', { style: { color: 'var(--text2)' } }, '…')
      : React.createElement(React.Fragment, null,
          React.createElement('div', { style: { fontWeight: 600, fontSize: 13, marginBottom: 2 } },
            `${data.FirstName || ''} ${data.LastName || ''}`.trim() || memberId,
          ),
          React.createElement('div', { style: { color: 'var(--text2)', fontSize: 11, marginBottom: 6 } }, memberId),
          React.createElement('div', {
            style: { display: 'grid', gridTemplateColumns: 'auto 1fr', columnGap: 10, rowGap: 3 },
          },
            React.createElement('span', { style: { color: 'var(--text2)' } }, 'Expires'),
            React.createElement('span', null, fmtDate(data.Expiration)),
            React.createElement('span', { style: { color: 'var(--text2)' } }, 'Type'),
            React.createElement('span', null, fmt(data.Type)),
            data.Gender
              ? React.createElement(React.Fragment, null,
                  React.createElement('span', { style: { color: 'var(--text2)' } }, 'Gender'),
                  React.createElement('span', null, data.Gender),
                ) : null,
            data.District
              ? React.createElement(React.Fragment, null,
                  React.createElement('span', { style: { color: 'var(--text2)' } }, 'District'),
                  React.createElement('span', null, data.District),
                ) : null,
          ),
        ),
  );
};

/**
 * MemberIdChip — renders a MemberID with hover tooltip support.
 * Pass tooltipHandlers from PaymentsPanel to activate tooltip.
 */
const MemberIdChip = ({ memberId, tooltipHandlers, onClick }) => {
  const ref = useRef(null);
  if (!memberId) return React.createElement('span', null, '—');
  return React.createElement('span', {
    ref,
    style: { cursor: 'pointer', color: 'var(--accent)', fontWeight: 500, whiteSpace: 'nowrap' },
    onMouseEnter: () => {
      if (ref.current && tooltipHandlers?.onHover) {
        tooltipHandlers.onHover(memberId, ref.current.getBoundingClientRect());
      }
    },
    onMouseLeave: tooltipHandlers?.onLeave,
    onClick: (e) => { e.stopPropagation(); if (onClick) onClick(memberId); },
  }, memberId);
};


// ---------------------------------------------------------------------------
// Gmail Quick-Approve Popover
// ---------------------------------------------------------------------------

const GmailQuickApprovePopover = ({ gmail, onClose, onApproved, tooltipHandlers }) => {
  const memoIds = extractMemberIds((gmail.Memo || '') + ' ' + (gmail.OriginalMemo || ''));
  const [memberId, setMemberId] = useState(memoIds[0] || '');
  const [intent, setIntent] = useState(suggestIntent(gmail.Amount));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [popoverPos, setPopoverPos] = useState({ left: 0, right: 'auto' });
  const popoverRef = useRef(null);
  const e = React.createElement;

  // Measure and adjust popover position to stay within viewport
  useEffect(() => {
    if (popoverRef.current) {
      const rect = popoverRef.current.getBoundingClientRect();
      if (rect.right > window.innerWidth - 8) {
        // Shift left if it goes off-screen
        setPopoverPos({ left: 'auto', right: 0 });
      }
    }
  }, []);

  const handleApprove = async () => {
    const mid = memberId.trim().toUpperCase();
    if (!mid) { setError('MemberID required'); return; }
    if (!/^A\d{4}$/.test(mid)) { setError('MemberID must be A followed by 4 digits (e.g. A0123)'); return; }
    setLoading(true); setError('');
    const r = await api('/api/payments/admin-create', {
      method: 'POST',
      body: JSON.stringify({
        memberId: mid, messageId: gmail.MessageId, paymentIntent: intent,
        notes: `Quick-approved from unmatched Gmail. Memo: ${gmail.Memo || ''}`,
      }),
    });
    setLoading(false);
    if (r.ok) { onApproved(mid, intent); }
    else { setError(r.error || 'Failed to approve'); }
  };

  return e('div', {
    ref: popoverRef,
    style: {
      position: 'absolute', zIndex: 50, top: '100%', ...popoverPos,
      background: 'var(--surface)', border: '1px solid var(--accent)',
      borderRadius: 'var(--radius)', padding: 16, minWidth: 340, maxWidth: 360,
      boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
    },
    onClick: ev => ev.stopPropagation(),
  },
    e('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 } },
      e('strong', { style: { fontSize: 13 } }, '⚡ Quick Approve Payment'),
      e('button', { onClick: onClose, style: { background: 'none', border: 'none', color: 'var(--text2)', cursor: 'pointer', fontSize: 16 } }, '✕'),
    ),
    e('div', { style: { fontSize: 12, color: 'var(--text2)', marginBottom: 12, padding: '8px 10px', background: 'var(--bg)', borderRadius: 4 } },
      e('div', null, `Sender: ${gmail.Sender || '—'}`),
      e('div', null, `Amount: ${fmtMoney(gmail.Amount)}  ·  Date: ${fmtDate(gmail.TransactionDate)}`),
      e('div', { style: { wordBreak: 'break-all' } }, `Memo: ${gmail.Memo || '—'}`),
    ),
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
        )
        : null,
      (memoIds.length === 0 || memberId === '') && e('input', {
        placeholder: 'e.g. A0123',
        value: memoIds.length === 0 ? memberId : '',
        onChange: ev => setMemberId(ev.target.value),
        style: { width: '100%', marginTop: memoIds.length > 0 ? 6 : 0, background: 'var(--bg)', border: '1px solid var(--border)', color: 'var(--text)', padding: '6px 8px', borderRadius: 'var(--radius)', fontSize: 13, boxSizing: 'border-box' },
      }),
    ),
    e('div', { style: { marginBottom: 12 } },
      e('label', { style: { fontSize: 12, color: 'var(--text2)', display: 'block', marginBottom: 4 } }, 'Payment Type'),
      e('select', {
        value: intent, onChange: ev => setIntent(ev.target.value),
        style: { width: '100%', background: 'var(--bg)', border: '1px solid var(--border)', color: 'var(--text)', padding: '6px 8px', borderRadius: 'var(--radius)', fontSize: 13 },
      },
        PAYMENT_INTENTS.map(opt => e('option', { key: opt, value: opt }, opt)),
      ),
    ),
    error && e('div', { style: { color: 'var(--red)', fontSize: 12, marginBottom: 8 } }, error),
    e('button', {
      className: 'btn btn-green', onClick: handleApprove, disabled: loading,
      style: { width: '100%' },
    }, loading ? 'Processing…' : `✓ Approve as ${intent}`),
  );
};


// ---------------------------------------------------------------------------
// Stats cards
// ---------------------------------------------------------------------------

const StatsCards = ({ stats }) => {
  const cards = [
    { label: 'Pending',         value: stats.pending        || 0, cls: 'yellow' },
    { label: 'Matched',         value: stats.matched        || 0, cls: 'accent' },
    { label: 'Unmatched Gmail', value: stats.unmatched_gmail || 0, cls: 'red'   },
    { label: 'Approved (30d)',  value: stats.approved_30d   || 0, cls: 'green'  },
    { label: 'Rejected (30d)',  value: stats.rejected_30d   || 0, cls: ''       },
    { label: 'Errors',          value: stats.errors         || 0, cls: stats.errors > 0 ? 'red' : '' },
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
// Member detail popup (click — full modal)
// ---------------------------------------------------------------------------

const MemberPopup = ({ memberId, onClose }) => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!memberId) return;
    setLoading(true);
    api(`/api/payments/member/${memberId}`).then(r => { if (r.ok) setData(r.data); setLoading(false); });
  }, [memberId]);

  if (!memberId) return null;
  const overlay = { position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.6)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center' };
  const panel   = { background: 'var(--surface)', borderRadius: 'var(--radius)', padding: 24, maxWidth: 600, width: '90%', maxHeight: '80vh', overflowY: 'auto' };
  const e = React.createElement;

  return e('div', { style: overlay, onClick: onClose },
    e('div', { style: panel, onClick: ev => ev.stopPropagation() },
      loading
        ? e('div', { className: 'loading' }, 'Loading...')
        : !data
          ? e('div', null, 'Member not found')
          : e(React.Fragment, null,
              e('div', { style: { display: 'flex', justifyContent: 'space-between', marginBottom: 16 } },
                e('h3', null, `${data.member.FirstName} ${data.member.LastName} (${memberId})`),
                e('button', { className: 'btn btn-sm btn-outline', onClick: onClose }, '✕'),
              ),
              e('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 16, fontSize: 13 } },
                e('div', null, e('span', { style: { color: 'var(--text2)' } }, 'Email: '), data.member.Email),
                e('div', null, e('span', { style: { color: 'var(--text2)' } }, 'Type: '), data.member.Type),
                e('div', null, e('span', { style: { color: 'var(--text2)' } }, 'Status: '), data.member.Status),
                e('div', null, e('span', { style: { color: 'var(--text2)' } }, 'Expiration: '), fmtDate(data.member.Expiration)),
                e('div', null, e('span', { style: { color: 'var(--text2)' } }, 'Gender: '), fmt(data.member.Gender)),
                e('div', null, e('span', { style: { color: 'var(--text2)' } }, 'District: '), fmt(data.member.District)),
                e('div', null, e('span', { style: { color: 'var(--text2)' } }, 'FamilyID: '), fmt(data.member.FamilyID)),
              ),
              data.family_members.length > 0 && e(React.Fragment, null,
                e('h4', { style: { marginBottom: 8, marginTop: 12 } }, 'Family Members'),
                e('table', { className: 'data-table', style: { fontSize: 12 } },
                  e('thead', null, e('tr', null, ['ID','Name','Email','Type','Expiration'].map(h => e('th', { key: h }, h)))),
                  e('tbody', null,
                    data.family_members.map(fm =>
                      e('tr', { key: fm.MemberID },
                        e('td', null, fm.MemberID), e('td', null, `${fm.FirstName} ${fm.LastName}`),
                        e('td', null, fm.Email), e('td', null, fm.Type), e('td', null, fmtDate(fm.Expiration)),
                      )
                    )
                  )
                )
              ),
              data.recent_payments.length > 0 && e(React.Fragment, null,
                e('h4', { style: { marginBottom: 8, marginTop: 12 } }, 'Recent Payments'),
                e('table', { className: 'data-table', style: { fontSize: 12 } },
                  e('thead', null, e('tr', null, ['Date','Amount','Intent','Source'].map(h => e('th', { key: h }, h)))),
                  e('tbody', null,
                    data.recent_payments.map(p =>
                      e('tr', { key: p.PaymentID },
                        e('td', null, fmtDate(p.PaymentDate)), e('td', null, fmtMoney(p.Amount)),
                        e('td', null, fmt(p.PaymentIntent)), e('td', null, fmt(p.Source)),
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
// Pending events table (left panel)
// ---------------------------------------------------------------------------

const PendingEventsTable = ({ events, selectedEventIds, focusedEventId, onToggle, onSelectAll, onViewMember, onFocus, tooltipHandlers }) => {
  const e = React.createElement;
  if (!events.length) {
    return e('div', { className: 'empty', style: { padding: 24, textAlign: 'center' } },
      e('div', { className: 'big' }, '✓'), 'No pending events'
    );
  }
  const allChecked  = events.length > 0 && events.every(ev => selectedEventIds.has(ev.EventID));
  const someChecked = events.some(ev => selectedEventIds.has(ev.EventID));

  return e('table', { className: 'data-table' },
    e('thead', null,
      e('tr', null,
        e('th', null,
          e('input', {
            type: 'checkbox', checked: allChecked,
            ref: el => { if (el) el.indeterminate = someChecked && !allChecked; },
            onChange: () => onSelectAll(allChecked ? [] : events.map(ev => ev.EventID)),
            title: allChecked ? 'Deselect all' : 'Select all',
          })
        ),
        e('th', null, 'Member'),
        e('th', null, 'Intent'),
        e('th', null, 'Amount'),
        e('th', null, 'Status'),
        e('th', null, 'Submitted'),
      )
    ),
    e('tbody', null,
      events.map(ev => {
        const isFocused  = focusedEventId === ev.EventID;
        const isSelected = selectedEventIds.has(ev.EventID);
        return e('tr', {
          key: ev.EventID,
          title: ev.EventID,
          style: {
            cursor: 'pointer',
            background: isSelected ? 'var(--surface2)' : undefined,
            borderLeft: isFocused ? '3px solid var(--yellow)' : '3px solid transparent',
            outline: isFocused ? '1px solid var(--yellow)22' : undefined,
          },
          onClick: () => onFocus(ev.EventID),
        },
          e('td', { onClick: ev2 => ev2.stopPropagation() },
            e('input', { type: 'checkbox', checked: isSelected, onChange: () => onToggle(ev.EventID) })
          ),
          e('td', null,
            e(MemberIdChip, { memberId: ev.MemberID, tooltipHandlers, onClick: onViewMember }),
            ev.FirstName
              ? e('span', { style: { color: 'var(--text2)', marginLeft: 4, fontSize: 11 } }, `${ev.FirstName} ${ev.LastName}`)
              : null,
          ),
          e('td', { style: { fontSize: 11 } }, fmt(ev.PaymentIntent)),
          e('td', null, fmtMoney(ev.Amount)),
          e('td', null, e(Badge, { status: ev.Status })),
          e('td', { style: { fontSize: 11 } }, fmtDate(ev.Timestamp)),
        );
      })
    )
  );
};


// ---------------------------------------------------------------------------
// Gmail table — normal mode + candidate/filter mode
// ---------------------------------------------------------------------------

/** Small badge showing how a gmail row relates to the focused event. */
const MatchCtxBadge = ({ ctx, processedTime }) => {
  const e = React.createElement;
  if (ctx === 'matched') {
    return e('span', { style: { fontSize: 10, fontWeight: 700, color: 'var(--green)', whiteSpace: 'nowrap' } }, '✓ LINKED');
  }
  if (processedTime) {
    return e('span', { style: { fontSize: 10, fontWeight: 700, color: 'var(--yellow)', whiteSpace: 'nowrap' }, title: `Processed: ${processedTime}` }, '⚠ PROCESSED');
  }
  return e('span', { style: { fontSize: 10, fontWeight: 700, color: 'var(--accent)', whiteSpace: 'nowrap' } }, '~ CANDIDATE');
};

const GmailTable = ({ rows, candidates, focusedEvent, candidatesLoading, selectedMessageId, onSelect, onQuickApproved, onClearFocus, tooltipHandlers }) => {
  const [activePopover, setActivePopover] = useState(null);
  const e = React.createElement;

  const isFilterMode = candidates !== null;
  const displayRows  = isFilterMode ? candidates : rows;

  if (candidatesLoading) {
    return e('div', { style: { padding: 24, textAlign: 'center', color: 'var(--text2)' } }, 'Loading candidates…');
  }
  if (!displayRows.length) {
    return e('div', { className: 'empty', style: { padding: 24, textAlign: 'center' } },
      e('div', { className: 'big' }, isFilterMode ? '🔍' : '✓'),
      isFilterMode ? 'No candidates found for this event' : 'No unmatched Gmail transactions',
    );
  }

  return e('table', { className: 'data-table' },
    e('thead', null,
      e('tr', null,
        e('th', null, ''),
        isFilterMode && e('th', null, 'Match'),
        e('th', null, 'Sender'),
        e('th', null, 'Amount'),
        e('th', null, 'Memo'),
        e('th', null, 'Tx Date'),
        e('th', null, 'Tx #'),
        e('th', null, ''),
      )
    ),
    e('tbody', null,
      displayRows.map(g => {
        const memoIds = extractMemberIds((g.Memo || '') + ' ' + (g.OriginalMemo || ''));
        const hasMemoId = memoIds.length > 0;
        const isOpen    = activePopover === g.MessageId;
        const isLinked  = g.MatchContext === 'matched';

        return e('tr', {
          key: g.MessageId,
          style: {
            cursor: 'pointer',
            background: selectedMessageId === g.MessageId
              ? 'var(--surface2)'
              : isLinked ? 'rgba(0,200,100,0.06)' : undefined,
            opacity: (isFilterMode && g.ProcessedTime && !isLinked) ? 0.72 : 1,
          },
          onClick: () => onSelect(g.MessageId === selectedMessageId ? null : g.MessageId),
        },
          e('td', null,
            e('input', { type: 'radio', checked: selectedMessageId === g.MessageId, onChange: () => onSelect(g.MessageId), onClick: ev => ev.stopPropagation() })
          ),
          isFilterMode && e('td', { style: { whiteSpace: 'nowrap' } },
            e(MatchCtxBadge, { ctx: g.MatchContext, processedTime: g.ProcessedTime })
          ),
          e('td', { style: { fontSize: 12 } }, fmt(g.Sender)),
          e('td', null, fmtMoney(g.Amount)),
          e('td', { style: { maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } },
            hasMemoId
              ? e('span', null,
                  e('span', {
                    style: {
                      display: 'inline-block', background: 'var(--accent)22', color: 'var(--accent)',
                      border: '1px solid var(--accent)44', borderRadius: 3, padding: '1px 5px',
                      fontSize: 11, fontWeight: 600, marginRight: 4, cursor: 'default',
                    },
                    title: `MemberID: ${memoIds.join(', ')}`,
                  }, memoIds[0]),
                  // If the memoID matches a known member, show tooltip chip
                  e(MemberIdChip, { memberId: memoIds[0], tooltipHandlers, onClick: () => {} }),
                  e('span', { style: { color: 'var(--text2)', marginLeft: 4 } }, fmt(g.Memo)),
                )
              : e('span', { style: { color: 'var(--text2)' } }, fmt(g.Memo)),
          ),
          e('td', { style: { fontSize: 11 } }, fmtDate(g.TransactionDate)),
          e('td', { style: { fontSize: 11, fontFamily: 'monospace' } }, fmt(g.TransactionNumber)?.slice(-8)),
          e('td', { style: { position: 'relative', whiteSpace: 'nowrap' }, onClick: ev => ev.stopPropagation() },
            !isLinked && e('button', {
              className: `btn btn-sm ${hasMemoId ? 'btn-green' : 'btn-outline'}`,
              style: { fontSize: 11, padding: '2px 8px' },
              title: hasMemoId ? `Quick-approve for ${memoIds.join(', ')}` : 'Create payment',
              onClick: ev => { ev.stopPropagation(); setActivePopover(isOpen ? null : g.MessageId); },
            }, hasMemoId ? '⚡ Quick' : '+ Create'),
            isOpen && e(GmailQuickApprovePopover, {
              gmail: g,
              onClose: () => setActivePopover(null),
              tooltipHandlers,
              onApproved: (mid, intent) => { setActivePopover(null); onQuickApproved(g.MessageId, mid, intent); },
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

const PaymentHistoryTable = ({ payments, tooltipHandlers, onViewMember }) => {
  const e = React.createElement;
  if (!payments.length) {
    return e('div', { className: 'empty', style: { padding: 16, textAlign: 'center' } }, 'No recent payments');
  }
  return e('table', { className: 'data-table', style: { fontSize: 12 } },
    e('thead', null,
      e('tr', null,
        ['Date','Member','Name','Amount','Intent','Type','Source','Processed By'].map(h =>
          e('th', { key: h }, h)
        )
      )
    ),
    e('tbody', null,
      payments.map(p =>
        e('tr', { key: p.PaymentID },
          e('td', null, fmtDate(p.PaymentDate)),
          e('td', null, e(MemberIdChip, { memberId: p.MemberID, tooltipHandlers, onClick: onViewMember })),
          e('td', null, p.FirstName ? `${p.FirstName} ${p.LastName}` : '—'),
          e('td', null, fmtMoney(p.Amount)),
          e('td', null, fmt(p.PaymentIntent)),
          e('td', null, fmt(p.MembershipType)),
          e('td', null, fmt(p.Source)),
          e('td', null, fmt(p.ProcessedBy)),
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
  const [intent, setIntent]   = useState('Individual Membership');
  const [notes, setNotes]     = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState('');
  const e = React.createElement;

  const handleCreate = async () => {
    if (!memberId.trim()) { setError('MemberID required'); return; }
    setLoading(true); setError('');
    const r = await api('/api/payments/admin-create', {
      method: 'POST',
      body: JSON.stringify({ memberId: memberId.trim(), messageId, paymentIntent: intent, notes }),
    });
    setLoading(false);
    if (r.ok) { onCreated(r); } else { setError(r.error || 'Failed'); }
  };

  const overlay = { position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.6)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center' };
  const panel   = { background: 'var(--surface)', borderRadius: 'var(--radius)', padding: 24, maxWidth: 480, width: '90%' };

  return e('div', { style: overlay, onClick: onClose },
    e('div', { style: panel, onClick: ev => ev.stopPropagation() },
      e('h3', { style: { marginBottom: 12 } }, 'Create Payment from Gmail'),
      gmail && e('div', { style: { fontSize: 12, color: 'var(--text2)', marginBottom: 12, padding: 8, background: 'var(--bg)', borderRadius: 4 } },
        e('div', null, `Sender: ${gmail.Sender}`), e('div', null, `Amount: ${fmtMoney(gmail.Amount)}`),
        e('div', null, `Memo: ${gmail.Memo || '—'}`), e('div', null, `Date: ${fmtDate(gmail.TransactionDate)}`),
      ),
      e('div', { style: { display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12 } },
        e('input', { placeholder: 'MemberID (e.g. A0123)', value: memberId, onChange: ev => setMemberId(ev.target.value), style: { background: 'var(--bg)', border: '1px solid var(--border)', color: 'var(--text)', padding: '8px 12px', borderRadius: 'var(--radius)' } }),
        e('select', { value: intent, onChange: ev => setIntent(ev.target.value), style: { background: 'var(--bg)', border: '1px solid var(--border)', color: 'var(--text)', padding: '8px 12px', borderRadius: 'var(--radius)' } },
          PAYMENT_INTENTS.map(opt => e('option', { key: opt, value: opt }, opt)),
        ),
        e('input', { placeholder: 'Notes (optional)', value: notes, onChange: ev => setNotes(ev.target.value), style: { background: 'var(--bg)', border: '1px solid var(--border)', color: 'var(--text)', padding: '8px 12px', borderRadius: 'var(--radius)' } }),
      ),
      error && e('div', { style: { color: 'var(--red)', fontSize: 12, marginBottom: 8 } }, error),
      e('div', { style: { display: 'flex', gap: 8, justifyContent: 'flex-end' } },
        e('button', { className: 'btn btn-outline', onClick: onClose }, 'Cancel'),
        e('button', { className: 'btn btn-green', onClick: handleCreate, disabled: loading }, loading ? 'Creating...' : 'Create & Approve'),
      ),
    )
  );
};


// ---------------------------------------------------------------------------
// Main PaymentsPanel component
// ---------------------------------------------------------------------------

const PaymentsPanel = () => {
  const e = React.createElement;

  // ── Data ──────────────────────────────────────────────────
  const [stats,          setStats]          = useState({});
  const [pendingEvents,  setPendingEvents]  = useState([]);
  const [unmatchedGmail, setUnmatchedGmail] = useState([]);
  const [history,        setHistory]        = useState([]);

  // ── Selection (checkboxes → bulk actions) ─────────────────
  const [selectedEventIds,  setSelectedEventIds]  = useState(new Set());
  const [selectedMessageId, setSelectedMessageId] = useState(null);

  // ── Focus (row click → gmail filter) ──────────────────────
  const [focusedEventId,    setFocusedEventId]    = useState(null);
  const [gmailCandidates,   setGmailCandidates]   = useState(null); // null = show all unmatched
  const [candidatesLoading, setCandidatesLoading] = useState(false);

  // ── UI ────────────────────────────────────────────────────
  const [subView,          setSubView]          = useState('reconcile');
  const [searchEvents,     setSearchEvents]     = useState('');
  const [searchGmail,      setSearchGmail]      = useState('');
  const [toast,            setToast]            = useState('');
  const [loading,          setLoading]          = useState(false);
  const [memberPopup,      setMemberPopup]      = useState(null);
  const [adminCreateGmail, setAdminCreateGmail] = useState(null);
  const [rejectNotes,      setRejectNotes]      = useState('');
  const [showRejectInput,  setShowRejectInput]  = useState(false);
  const [showEvents,       setShowEvents]       = useState(true); // side-by-side toggle
  const [showManualMatch,  setShowManualMatch]  = useState(false); // manual match modal toggle

  // ── Tooltip ───────────────────────────────────────────────
  const [tooltip, setTooltip] = useState({ memberId: null, rect: null, data: null });
  const tooltipTimer = useRef(null);

  const handleMemberHover = useCallback((memberId, rect) => {
    if (tooltipTimer.current) clearTimeout(tooltipTimer.current);
    setTooltip(prev => ({ memberId, rect, data: _memberCache[memberId] || null }));
    if (!_memberCache[memberId]) {
      api(`/api/payments/member-quick/${memberId}`).then(r => {
        if (r.ok) {
          _memberCache[memberId] = r.data;
          setTooltip(prev => prev.memberId === memberId ? { ...prev, data: r.data } : prev);
        }
      });
    }
  }, []);

  const handleMemberLeave = useCallback(() => {
    tooltipTimer.current = setTimeout(() => setTooltip({ memberId: null, rect: null, data: null }), 150);
  }, []);

  const tooltipHandlers = { onHover: handleMemberHover, onLeave: handleMemberLeave };

  // ── Event focus → load gmail candidates ───────────────────
  const handleEventFocus = useCallback((eventId) => {
    if (focusedEventId === eventId) {
      // Toggle off (click same row again)
      setFocusedEventId(null);
      setGmailCandidates(null);
      return;
    }
    setFocusedEventId(eventId);
    setGmailCandidates(null);
    setCandidatesLoading(true);
    api(`/api/payments/gmail-candidates/${eventId}`).then(r => {
      setCandidatesLoading(false);
      if (r.ok) setGmailCandidates(r.data);
    });
  }, [focusedEventId]);

  const clearEventFocus = useCallback(() => {
    setFocusedEventId(null);
    setGmailCandidates(null);
  }, []);

  // ── Data loading ──────────────────────────────────────────
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

  // ── Checkbox selection helpers ────────────────────────────
  const toggleEvent    = (id) => setSelectedEventIds(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const selectAllEvents = (ids) => setSelectedEventIds(new Set(ids));

  const singleSelectedId = selectedEventIds.size === 1 ? [...selectedEventIds][0] : null;
  const selEvent  = singleSelectedId ? pendingEvents.find(ev => ev.EventID === singleSelectedId) : null;
  const selGmail  = unmatchedGmail.find(g => g.MessageId === selectedMessageId);
  const focusedEvent = pendingEvents.find(ev => ev.EventID === focusedEventId) || null;

  // ── Actions ───────────────────────────────────────────────
  const handleManualMatch = async () => {
    if (!singleSelectedId || !selectedMessageId) { showToast('Select exactly one event AND one gmail row'); return; }
    setLoading(true);
    const r = await api('/api/payments/manual-match', { method: 'POST', body: JSON.stringify({ eventId: singleSelectedId, messageId: selectedMessageId }) });
    setLoading(false);
    if (r.ok) { showToast(`Matched ↔`); setSelectedEventIds(new Set()); setSelectedMessageId(null); clearEventFocus(); loadAll(); }
    else { showToast(`Error: ${r.error}`); }
  };

  const handleAutoMatch = async () => {
    setLoading(true);
    const r = await api('/api/payments/auto-match', { method: 'POST' });
    setLoading(false);
    if (r.ok) { const s = r.data; showToast(`Auto-match: ${s.matched} matched, ${s.skipped} skipped, ${s.errors} errors`); loadAll(); }
    else { showToast(`Error: ${r.error}`); }
  };

  const handleAutoGuessAndApprove = async () => {
    if (!confirm('Run Auto-Match then approve ALL matched events?\nThis will update member expirations and send renewal emails.')) return;
    setLoading(true);
    showToast('Step 1/2: Running auto-match…');
    const matchRes = await api('/api/payments/auto-match', { method: 'POST' });
    if (!matchRes.ok) { setLoading(false); showToast(`Auto-match failed: ${matchRes.error}`); return; }
    const { matched: newlyMatched } = matchRes.data;
    const evRes = await api('/api/payments/pending-events');
    if (!evRes.ok) { setLoading(false); showToast(`Matched ${newlyMatched} but failed to reload`); return; }
    const allMatched = evRes.data.filter(ev => ev.Status === 'matched');
    if (!allMatched.length) { setLoading(false); showToast(`Auto-match: ${newlyMatched} newly matched, 0 ready to approve`); loadAll(); return; }
    showToast(`Step 2/2: Approving ${allMatched.length} matched event(s)…`);
    let approved = 0, failed = 0, failedIds = [];
    for (const ev of allMatched) {
      const r = await api(`/api/payments/approve/${ev.EventID}`, { method: 'POST', body: '{}' });
      if (r.ok) { approved++; } else { failed++; failedIds.push(ev.EventID.slice(0, 12)); }
    }
    setLoading(false);
    showToast(`Done! ${newlyMatched} matched → ${approved} approved${failed ? `, ${failed} failed: ${failedIds.join(', ')}` : ''}`);
    setSelectedEventIds(new Set()); clearEventFocus(); loadAll();
  };

  const handleApproveSelected = async () => {
    const ids = [...selectedEventIds];
    if (!ids.length) { showToast('Select at least one event'); return; }
    setLoading(true);
    let approved = 0, failed = 0;
    for (const eid of ids) { const r = await api(`/api/payments/approve/${eid}`, { method: 'POST', body: '{}' }); r.ok ? approved++ : failed++; }
    setLoading(false);
    showToast(`Approved ${approved}${failed ? `, ${failed} failed` : ''}`);
    setSelectedEventIds(new Set()); loadAll();
  };

  const handleApproveAllMatched = async () => {
    const matchedIds = pendingEvents.filter(ev => ev.Status === 'matched').map(ev => ev.EventID);
    if (!matchedIds.length) { showToast('No matched events to approve'); return; }
    if (!confirm(`Approve all ${matchedIds.length} matched event(s)?`)) return;
    setLoading(true);
    let approved = 0, failed = 0, failedIds = [];
    for (const eid of matchedIds) {
      const r = await api(`/api/payments/approve/${eid}`, { method: 'POST', body: '{}' });
      if (r.ok) { approved++; } else { failed++; failedIds.push(eid.slice(0, 12)); }
    }
    setLoading(false);
    showToast(`Approved ${approved}${failed ? ` — ${failed} failed: ${failedIds.join(', ')}` : ''}`);
    setSelectedEventIds(new Set()); loadAll();
  };

  const handleReject = async () => {
    if (!singleSelectedId) { showToast('Select exactly one event to reject'); return; }
    if (!rejectNotes.trim()) { showToast('Rejection reason required'); return; }
    setLoading(true);
    const r = await api(`/api/payments/reject/${singleSelectedId}`, { method: 'POST', body: JSON.stringify({ notes: rejectNotes }) });
    setLoading(false);
    if (r.ok) { showToast(`Rejected`); setSelectedEventIds(new Set()); setShowRejectInput(false); setRejectNotes(''); loadAll(); }
    else { showToast(`Error: ${r.error}`); }
  };

  const handleQuickApproved = (messageId, memberId, intent) => {
    showToast(`✓ Approved ${intent} for ${memberId}`);
    clearEventFocus();
    loadAll();
  };

  // ── Derived ───────────────────────────────────────────────
  const matchedCount = pendingEvents.filter(ev => ev.Status === 'matched').length;
  const selectedMatchedCount = [...selectedEventIds].filter(id => {
    const ev = pendingEvents.find(ex => ex.EventID === id);
    return ev && ev.Status === 'matched';
  }).length;

  // ── Render ────────────────────────────────────────────────
  return e('div', null,
    // Toast
    toast && e('div', {
      style: { position: 'fixed', top: 16, right: 16, zIndex: 200, background: 'var(--surface)', border: '1px solid var(--accent)', borderRadius: 'var(--radius)', padding: '10px 16px', fontSize: 13, boxShadow: '0 4px 12px rgba(0,0,0,0.3)' }
    }, toast),

    // Hover tooltip (rendered at root level so it's always on top)
    e(MemberTooltip, { memberId: tooltip.memberId, anchorRect: tooltip.rect, data: tooltip.data }),

    // Member popup (click → full modal)
    memberPopup && e(MemberPopup, { memberId: memberPopup, onClose: () => setMemberPopup(null) }),

    // Admin create modal
    adminCreateGmail && e(AdminCreateModal, {
      messageId: adminCreateGmail.MessageId, gmail: adminCreateGmail,
      onClose: () => setAdminCreateGmail(null),
      onCreated: (r) => { setAdminCreateGmail(null); showToast(`Payment created! Updated: ${(r.updated_members || []).join(', ')}`); loadAll(); },
    }),

    // Stats
    e(StatsCards, { stats }),

    // Sub-tabs
    e('div', { style: { display: 'flex', gap: 8, marginBottom: 16 } },
      e('button', { className: `btn ${subView === 'reconcile' ? 'btn-primary' : 'btn-outline'}`, onClick: () => setSubView('reconcile') }, 'Reconcile'),
      e('button', { className: `btn ${subView === 'history'   ? 'btn-primary' : 'btn-outline'}`, onClick: () => setSubView('history')   }, 'Payment History'),
    ),

    // ── Reconcile view ──────────────────────────────────────
    subView === 'reconcile' && e(React.Fragment, null,

      // Action toolbar
      e('div', { className: 'toolbar', style: { marginBottom: 12 } },
        e('button', { className: 'btn btn-primary', onClick: handleManualMatch, disabled: loading || !singleSelectedId || !selectedMessageId, title: 'Select one event + one gmail row' }, '🔗 Manual Match'),
        singleSelectedId && e('button', { className: 'btn btn-green', onClick: () => setShowManualMatch(true), disabled: loading, title: 'Approve & link selected event to transaction' }, '✓ Approve Selected'),
        e('button', { className: 'btn btn-secondary', onClick: () => setShowManualMatch(true), disabled: loading, title: 'Popup assistant for multiple pending events' }, '📋 Approve Pending (Batch)'),
        e('button', { className: 'btn btn-orange', onClick: handleAutoMatch, disabled: loading }, '⚡ Auto-Match All'),
        e('button', { className: 'btn btn-primary', onClick: handleAutoGuessAndApprove, disabled: loading, style: { background: 'var(--purple, #7c3aed)', borderColor: 'var(--purple, #7c3aed)' }, title: 'Auto-match all then approve matched → updates expirations + sends emails' }, '🚀 Auto-Guess & Approve All'),
        matchedCount > 0 && e('button', { className: 'btn btn-green', onClick: handleApproveAllMatched, disabled: loading }, `✓ Approve All Matched (${matchedCount})`),
        selectedMatchedCount > 0 && e('button', { className: 'btn btn-green', onClick: handleApproveSelected, disabled: loading, style: { opacity: 0.85 } }, `✓ Approve Selected (${selectedMatchedCount})`),
        singleSelectedId && e('button', { className: 'btn btn-outline', onClick: () => setShowRejectInput(!showRejectInput), style: { color: 'var(--red)' } }, '✕ Reject'),
        showRejectInput && e(React.Fragment, null,
          e('input', { placeholder: 'Rejection reason...', value: rejectNotes, onChange: ev => setRejectNotes(ev.target.value), style: { minWidth: 200 } }),
          e('button', { className: 'btn btn-sm', style: { background: 'var(--red)', color: '#fff' }, onClick: handleReject, disabled: loading }, 'Confirm Reject'),
        ),
      ),

      // Selection summary bar
      (selectedEventIds.size > 0 || selectedMessageId) && e('div', {
        style: { padding: '6px 12px', marginBottom: 8, fontSize: 12, background: 'var(--surface)', borderRadius: 'var(--radius)', border: '1px solid var(--border)', display: 'flex', gap: 12, alignItems: 'center' }
      },
        selectedEventIds.size > 0 && e('span', null,
          `${selectedEventIds.size} event${selectedEventIds.size > 1 ? 's' : ''} selected`,
          selectedMatchedCount > 0 && e('span', { style: { color: 'var(--green)', marginLeft: 6 } }, `(${selectedMatchedCount} matched)`),
        ),
        selectedMessageId && e('span', null, `Gmail: `, e('strong', null, selectedMessageId.slice(0, 16))),
        e('button', { className: 'btn btn-sm btn-outline', style: { fontSize: 11, padding: '1px 6px', marginLeft: 'auto' }, onClick: () => { setSelectedEventIds(new Set()); setSelectedMessageId(null); } }, 'Clear'),
      ),

      // ── Side-by-side layout ────────────────────────────────
      e('div', { style: { display: 'flex', gap: 16, alignItems: 'flex-start' } },

        // LEFT: Events panel
        showEvents && e('div', {
          style: {
            flex: '0 0 420px', minWidth: 0, border: '1px solid var(--border)',
            borderRadius: 'var(--radius)', display: 'flex', flexDirection: 'column',
          }
        },
          // Header
          e('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 12px', borderBottom: '1px solid var(--border)', background: 'var(--surface)' } },
            e('span', { style: { fontSize: 13, fontWeight: 600 } },
              `Events (${pendingEvents.length})`,
              matchedCount > 0 && e('span', { style: { color: 'var(--accent)', marginLeft: 8, fontWeight: 400, fontSize: 12 } }, `${matchedCount} matched`),
              focusedEventId && e('span', { style: { color: 'var(--yellow)', marginLeft: 8, fontWeight: 400, fontSize: 11 } }, '· 1 focused'),
            ),
            e('input', {
              placeholder: 'Search…',
              value: searchEvents,
              onChange: ev => setSearchEvents(ev.target.value),
              style: { background: 'var(--bg)', border: '1px solid var(--border)', color: 'var(--text)', padding: '3px 7px', borderRadius: 'var(--radius)', fontSize: 12, width: 130 },
            }),
          ),
          // Table
          e('div', { style: { overflowY: 'auto', maxHeight: 520 } },
            e(PendingEventsTable, {
              events: pendingEvents,
              selectedEventIds,
              focusedEventId,
              onToggle: toggleEvent,
              onSelectAll: selectAllEvents,
              onViewMember: setMemberPopup,
              onFocus: handleEventFocus,
              tooltipHandlers,
            }),
          ),
        ),

        // RIGHT: Gmail panel
        e('div', { style: { flex: 1, minWidth: 0, border: '1px solid var(--border)', borderRadius: 'var(--radius)', display: 'flex', flexDirection: 'column' } },
          // Header
          e('div', { style: { padding: '8px 12px', borderBottom: '1px solid var(--border)', background: 'var(--surface)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 } },
            e('div', { style: { display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 } },
              // Toggle events panel button
              e('button', {
                className: 'btn btn-sm btn-outline',
                onClick: () => setShowEvents(v => !v),
                title: showEvents ? 'Hide events panel' : 'Show events panel',
                style: { fontSize: 11, padding: '2px 7px', whiteSpace: 'nowrap' },
              }, showEvents ? '◀ Hide Events' : '▶ Show Events'),

              // Filter badge when an event is focused
              focusedEvent
                ? e('div', { style: { display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 } },
                    e('span', { style: { fontSize: 11, color: 'var(--yellow)', fontWeight: 600, whiteSpace: 'nowrap' } }, '🔍 Candidates for'),
                    e(MemberIdChip, { memberId: focusedEvent.MemberID, tooltipHandlers, onClick: setMemberPopup }),
                    e('span', { style: { fontSize: 11, color: 'var(--text2)' } }, `${fmtMoney(focusedEvent.Amount)} · ${focusedEvent.PaymentIntent}`),
                    e('button', { className: 'btn btn-sm btn-outline', onClick: clearEventFocus, style: { fontSize: 10, padding: '1px 5px', marginLeft: 2 } }, '✕ Clear'),
                    gmailCandidates !== null && e('span', { style: { fontSize: 11, color: 'var(--text2)', whiteSpace: 'nowrap' } },
                      `— ${gmailCandidates.length} row${gmailCandidates.length !== 1 ? 's' : ''} (incl. processed)`
                    ),
                  )
                : e('span', { style: { fontSize: 13, fontWeight: 600 } },
                    `Unmatched Gmail (${unmatchedGmail.length})`,
                    unmatchedGmail.filter(g => extractMemberIds((g.Memo || '') + (g.OriginalMemo || '')).length > 0).length > 0
                      && e('span', { style: { marginLeft: 8, fontSize: 11, color: 'var(--green)', fontWeight: 400 } },
                           `· ${unmatchedGmail.filter(g => extractMemberIds((g.Memo||'')+(g.OriginalMemo||'')).length > 0).length} with MemberID ⚡`
                         ),
                  ),
            ),
            // Gmail search (only in normal mode)
            !focusedEvent && e('input', {
              placeholder: 'Search gmail…',
              value: searchGmail,
              onChange: ev => setSearchGmail(ev.target.value),
              style: { background: 'var(--bg)', border: '1px solid var(--border)', color: 'var(--text)', padding: '3px 7px', borderRadius: 'var(--radius)', fontSize: 12, width: 160 },
            }),
          ),
          // Table
          e('div', { style: { overflowY: 'auto', maxHeight: 520 } },
            e(GmailTable, {
              rows: unmatchedGmail,
              candidates: gmailCandidates,
              focusedEvent,
              candidatesLoading,
              selectedMessageId,
              onSelect: setSelectedMessageId,
              onQuickApproved: handleQuickApproved,
              onClearFocus: clearEventFocus,
              tooltipHandlers,
            }),
          ),
          // Footer action for selected gmail
          selGmail && !focusedEvent && e('div', { style: { padding: '8px 12px', borderTop: '1px solid var(--border)' } },
            e('button', { className: 'btn btn-sm btn-outline', onClick: () => setAdminCreateGmail(selGmail) }, '+ Create Payment from Selected Gmail'),
          ),
        ),
      ),
    ),

    // ── History view ────────────────────────────────────────
    subView === 'history' && e('div', null,
      e('h3', { style: { fontSize: 14, marginBottom: 12 } }, 'Payment History (Last 90 Days)'),
      e(PaymentHistoryTable, { payments: history, tooltipHandlers, onViewMember: setMemberPopup }),
    ),

    // ── Manual Match Modal ──────────────────────────────────
    window.ManualEventMatchModal && e(window.ManualEventMatchModal, {
      isOpen: showManualMatch,
      onClose: () => setShowManualMatch(false),
      onMatchApproved: (eventId) => {
        showToast(`✓ Approved & linked ${eventId.slice(0, 12)}`);
        setShowManualMatch(false);
        loadAll();
      }
    }),
  );
};

// Export for use in index.html
window.PaymentsPanel = PaymentsPanel;
