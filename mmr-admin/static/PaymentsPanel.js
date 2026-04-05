/**
 * PaymentsPanel — React component for the Payments tab in mmr-admin.
 *
 * Layout: side-by-side reconcile view
 *   Left panel:  pending submissions (toggleable)
 *   Right panel: gmail_transactions (filtered when a submission is focused)
 *
 * Features:
 *   - MemberID hover tooltip (name, expiration, type, gender, district)
 *   - Submission row focus → auto-filter gmail candidates
 *   - Toggle submissions panel visibility (left ↔ full-width)
 *   - Quick-approve popover with manual member search
 *   - Expandable transaction rows with column resizing
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
  try {
    if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v)) {
      const [year, month, day] = v.split('T')[0].split('-');
      const date = new Date(year, month - 1, day);
      return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    }
    return new Date(v).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }
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

const _memberCache = {};

const MemberTooltip = ({ memberId, anchorRect, data }) => {
  if (!memberId || !anchorRect) return null;

  const TOOLTIP_WIDTH = 270;
  const TOOLTIP_HEIGHT = 160;
  const MARGIN = 6;
  const EDGE_PADDING = 8;

  let left = anchorRect.left - TOOLTIP_WIDTH / 2 + anchorRect.width / 2;
  left = Math.max(EDGE_PADDING, Math.min(left, window.innerWidth - TOOLTIP_WIDTH - EDGE_PADDING));

  let top = anchorRect.bottom + MARGIN;
  const spaceBelow = window.innerHeight - anchorRect.bottom;
  const spaceAbove = anchorRect.top;

  if (spaceBelow < TOOLTIP_HEIGHT + MARGIN && spaceAbove > TOOLTIP_HEIGHT + MARGIN) {
    top = anchorRect.top - TOOLTIP_HEIGHT - MARGIN;
  }

  return React.createElement('div', {
    style: {
      position: 'fixed', top, left, zIndex: 1000,
      background: 'var(--surface)', border: '1px solid var(--accent)',
      borderRadius: 8, padding: '10px 14px', fontSize: 12,
      boxShadow: '0 6px 24px rgba(0,0,0,0.5)', pointerEvents: 'none',
      minWidth: 250, maxWidth: 320,
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
            style: { display: 'grid', gridTemplateColumns: 'auto 1fr', columnGap: 10, rowGap: 3, fontSize: 11 },
          },
            React.createElement('span', { style: { color: 'var(--text2)' } }, 'Expires'),
            React.createElement('span', null, fmtDate(data.Expiration)),
            React.createElement('span', { style: { color: 'var(--text2)' } }, 'Type'),
            React.createElement('span', null, fmt(data.Type)),
            data.Email
              ? React.createElement(React.Fragment, null,
                  React.createElement('span', { style: { color: 'var(--text2)' } }, 'Email'),
                  React.createElement('span', { style: { wordBreak: 'break-all' } }, data.Email),
                ) : null,
            data.WeChatID
              ? React.createElement(React.Fragment, null,
                  React.createElement('span', { style: { color: 'var(--text2)' } }, 'WeChat'),
                  React.createElement('span', null, data.WeChatID),
                ) : null,
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

const fuzzyMatchMember = (query, member) => {
  if (!query) return true;
  const q = query.toLowerCase();
  const searchFields = [
    (member.FirstName || ''),
    (member.LastName || ''),
    (member.MemberID || ''),
    (member.Email || ''),
    (member.WeChatID || ''),
  ].join(' ').toLowerCase();
  return q.split(/\s+/).every(word => searchFields.includes(word));
};

const GmailQuickApprovePopover = ({ gmail, onClose, onApproved, tooltipHandlers }) => {
  const memoIds = extractMemberIds((gmail.Memo || '') + ' ' + (gmail.OriginalMemo || ''));
  const [memberId, setMemberId] = useState(memoIds[0] || '');
  const [intent, setIntent] = useState(suggestIntent(gmail.Amount));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [popoverPos, setPopoverPos] = useState({ left: 0, right: 'auto' });
  const [memberData, setMemberData] = useState(null);
  const [memberLoading, setMemberLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [allMembers, setAllMembers] = useState([]);
  const [membersLoaded, setMembersLoaded] = useState(false);
  const [searchResults, setSearchResults] = useState([]);
  const popoverRef = useRef(null);
  const e = React.createElement;

  useEffect(() => {
    if (!membersLoaded) {
      api('/api/payments/member-quick/all').then(r => {
        if (r.ok) {
          const members = Array.isArray(r.data) ? r.data : (r.data && Array.isArray(r.data.data) ? r.data.data : []);
          setAllMembers(members);
        }
        setMembersLoaded(true);
      });
    }
  }, []);

  useEffect(() => {
    if (popoverRef.current) {
      const rect = popoverRef.current.getBoundingClientRect();
      if (rect.right > window.innerWidth - 8) {
        setPopoverPos({ left: 'auto', right: 0 });
      }
    }
  }, []);

  useEffect(() => {
    if (!searchQuery.trim()) {
      setSearchResults([]);
      return;
    }
    const filtered = allMembers.filter(m => fuzzyMatchMember(searchQuery, m)).slice(0, 10);
    setSearchResults(filtered);
  }, [searchQuery, allMembers]);

  useEffect(() => {
    const mid = memberId.trim().toUpperCase();
    if (!mid || !/^A\d{4}$/.test(mid)) {
      setMemberData(null);
      return;
    }
    setMemberLoading(true);
    api(`/api/payments/member-quick/${mid}`).then(r => {
      if (r.ok) setMemberData(r.data);
      else setMemberData(null);
      setMemberLoading(false);
    }).catch(() => {
      setMemberData(null);
      setMemberLoading(false);
    });
  }, [memberId]);

  const handleSelectMember = (member) => {
    setMemberId(member.MemberID);
    setSearchQuery('');
    setSearchResults([]);
  };

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
      e('label', { style: { fontSize: 12, color: 'var(--text2)', display: 'block', marginBottom: 4 } }, 'Find Member'),
      e('input', {
        placeholder: 'Search by name, WeChat ID, or A####',
        value: searchQuery,
        onChange: ev => setSearchQuery(ev.target.value),
        style: { width: '100%', background: 'var(--bg)', border: '1px solid var(--border)', color: 'var(--text)', padding: '6px 8px', borderRadius: 'var(--radius)', fontSize: 13, boxSizing: 'border-box' },
      }),
      searchResults.length > 0 && e('div', {
        style: {
          marginTop: 6, maxHeight: 200, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 4, fontSize: 11,
        },
      },
        searchResults.map(m => e('div', {
          key: m.MemberID,
          onClick: () => handleSelectMember(m),
          style: {
            padding: '6px 8px', borderBottom: '1px solid var(--border)', cursor: 'pointer', background: 'var(--bg)',
            display: 'flex', justifyContent: 'space-between', fontSize: 11,
          },
          onMouseOver: ev => ev.target.style.background = 'var(--accent)22',
          onMouseOut: ev => ev.target.style.background = 'var(--bg)',
        },
          e('div', null,
            e('div', { style: { fontWeight: 500 } }, `${m.FirstName || ''} ${m.LastName || ''}`.trim()),
            e('div', { style: { color: 'var(--text2)', fontSize: 10 } }, `${m.MemberID}${m.District ? ' · ' + m.District : ''}`),
            m.Email && e('div', { style: { color: 'var(--text2)', fontSize: 9, marginTop: 2, wordBreak: 'break-all' } }, m.Email),
          ),
          e('div', { style: { textAlign: 'right', color: 'var(--text2)' } },
            e('div', null, m.Type || '—'),
            e('div', { style: { fontSize: 10 } }, fmtDate(m.Expiration) || '—'),
          ),
        ))
      ),
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
      memberLoading && e('div', { style: { fontSize: 12, color: 'var(--text2)', marginTop: 8 } }, '⏳ Loading member…'),
      memberData && !memberLoading && e('div', {
        style: {
          marginTop: 8, padding: '8px 10px', background: 'var(--bg)', borderRadius: 4, borderLeft: '3px solid var(--green)', fontSize: 11, lineHeight: 1.4,
        },
      },
        e('div', { style: { fontWeight: 600, color: 'var(--text)' } }, `${memberData.FirstName || ''} ${memberData.LastName || ''}`.trim() || memberId),
        e('div', { style: { color: 'var(--text2)' } }, `Expires: ${fmtDate(memberData.Expiration) || '—'}`),
        memberData.WeChatID && e('div', { style: { color: 'var(--text2)' } }, `WeChat: ${memberData.WeChatID}`),
      ),
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

const StatsCards = ({ stats = {}, onAutoguess, autoguessLoading = false }) => {
  const cards = [
    { label: 'Pending',         value: stats.pending        || 0, cls: 'yellow' },
    { label: 'Matched',         value: stats.matched        || 0, cls: 'accent' },
    { label: 'Unmatched Gmail', value: stats.unmatched_gmail || 0, cls: 'red'   },
    { label: 'Approved (30d)',  value: stats.approved_30d   || 0, cls: 'green'  },
    { label: 'Rejected (30d)',  value: stats.rejected_30d   || 0, cls: ''       },
    { label: 'Errors',          value: stats.errors         || 0, cls: (stats.errors || 0) > 0 ? 'red' : '' },
  ];
  const e = React.createElement;
  return e('div', { style: { display: 'flex', flexDirection: 'column', gap: 12 } },
    e('div', { className: 'stats-grid' },
      cards.map((c, i) =>
        e('div', { className: 'stat-card', key: i },
          e('div', { className: 'label' }, c.label),
          e('div', { className: `value ${c.cls}` }, c.value),
        )
      )
    ),
    e('button', {
      className: 'btn btn-primary',
      onClick: onAutoguess,
      disabled: autoguessLoading,
      title: 'Automatically match transactions with explicit memberID in memo',
      style: {
        padding: '10px 16px',
        fontSize: 13,
        fontWeight: 600,
        borderRadius: 'var(--radius)',
        width: 'fit-content',
      }
    }, autoguessLoading ? '⏳ Autoguessing...' : '🤖 Autoguess + Approve')
  );
};


// ---------------------------------------------------------------------------
// Pending submissions table (left panel)
// ---------------------------------------------------------------------------

const PendingSubmissionsTable = ({ submissions, selectedSubmissionIds, focusedSubmissionId, onToggle, onSelectAll, onViewMember, onFocus, tooltipHandlers }) => {
  const e = React.createElement;
  if (!submissions.length) {
    return e('div', { className: 'empty', style: { padding: 24, textAlign: 'center' } },
      e('div', { className: 'big' }, '✓'), 'No pending submissions'
    );
  }
  const allChecked  = submissions.length > 0 && submissions.every(sub => selectedSubmissionIds.has(sub.SubmissionID));
  const someChecked = submissions.some(sub => selectedSubmissionIds.has(sub.SubmissionID));

  return e('table', { className: 'data-table' },
    e('thead', null,
      e('tr', null,
        e('th', null,
          e('input', {
            type: 'checkbox', checked: allChecked,
            ref: el => { if (el) el.indeterminate = someChecked && !allChecked; },
            onChange: () => onSelectAll(allChecked ? [] : submissions.map(sub => sub.SubmissionID)),
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
      submissions.map(sub => {
        const isFocused  = focusedSubmissionId === sub.SubmissionID;
        const isSelected = selectedSubmissionIds.has(sub.SubmissionID);
        return e('tr', {
          key: sub.SubmissionID,
          title: sub.SubmissionID,
          style: {
            cursor: 'pointer',
            background: isSelected ? 'var(--surface2)' : undefined,
            borderLeft: isFocused ? '3px solid var(--yellow)' : '3px solid transparent',
            outline: isFocused ? '1px solid var(--yellow)22' : undefined,
          },
          onClick: () => onFocus(sub.SubmissionID),
        },
          e('td', { onClick: ev2 => ev2.stopPropagation() },
            e('input', { type: 'checkbox', checked: isSelected, onChange: () => onToggle(sub.SubmissionID) })
          ),
          e('td', null,
            e(MemberIdChip, { memberId: sub.MemberID, tooltipHandlers, onClick: onViewMember }),
            sub.FirstName
              ? e('span', { style: { color: 'var(--text2)', marginLeft: 4, fontSize: 11 } }, `${sub.FirstName} ${sub.LastName}`)
              : null,
          ),
          e('td', { style: { fontSize: 11 } }, fmt(sub.PaymentIntent)),
          e('td', null, fmtMoney(sub.Amount)),
          e('td', null, e(Badge, { status: sub.Status })),
          e('td', { style: { fontSize: 11 } }, fmtDate(sub.Timestamp)),
        );
      })
    )
  );
};


// ---------------------------------------------------------------------------
// Gmail table — normal mode + candidate/filter mode
// ---------------------------------------------------------------------------

// Determine if a Gmail transaction is linked (has Notes) or still a candidate
const getMatchContext = (gmail) => {
  if (gmail.Notes && gmail.Notes.trim()) {
    return { status: 'matched', time: gmail.UpdatedAt };  // Notes exist = linked to payment
  }
  return { status: 'candidate', time: null };  // No notes = still unmatched
};

const MatchCtxBadge = ({ status, linkedTime }) => {
  const e = React.createElement;
  if (status === 'matched') {
    return e('span', { style: { fontSize: 10, fontWeight: 700, color: 'var(--green)', whiteSpace: 'nowrap' } }, '✓ LINKED');
  }
  if (linkedTime) {
    return e('span', { style: { fontSize: 10, fontWeight: 700, color: 'var(--yellow)', whiteSpace: 'nowrap' }, title: `Linked: ${linkedTime}` }, '⚠ LINKED');
  }
  return e('span', { style: { fontSize: 10, fontWeight: 700, color: 'var(--accent)', whiteSpace: 'nowrap' } }, '~ CANDIDATE');
};

const GmailTable = ({ rows, candidates, focusedSubmission, candidatesLoading, selectedMessageId, onSelect, onQuickApproved, onClearFocus, tooltipHandlers, activePopover, onPopoverToggle }) => {
  const [colWidths, setColWidths] = useState({ sender: 120, memo: 200 });
  const [resizing, setResizing] = useState(null);
  const tableRef = useRef(null);
  const e = React.createElement;

  // Track which Gmail row is open for popover (for showing popover data)
  const activeGmailData = activePopover ? rows.find(g => g.MessageId === activePopover) : null;

  const isFilterMode = candidates !== null;
  const displayRows  = isFilterMode ? candidates : rows;

  const handleResizeStart = (col, ev) => {
    ev.preventDefault();
    setResizing({ col, startX: ev.clientX, startWidth: colWidths[col] });
  };

  useEffect(() => {
    if (!resizing) return;
    const handleMouseMove = (ev) => {
      const delta = ev.clientX - resizing.startX;
      const newWidth = Math.max(80, resizing.startWidth + delta);
      setColWidths(prev => ({ ...prev, [resizing.col]: newWidth }));
    };
    const handleMouseUp = () => setResizing(null);
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [resizing]);

  if (candidatesLoading) {
    return e('div', { style: { padding: 24, textAlign: 'center', color: 'var(--text2)' } }, 'Loading candidates…');
  }
  if (!displayRows.length) {
    return e('div', { className: 'empty', style: { padding: 24, textAlign: 'center' } },
      e('div', { className: 'big' }, isFilterMode ? '🔍' : '✓'),
      isFilterMode ? 'No candidates found for this submission' : 'No unmatched Gmail transactions',
    );
  }

  return e('table', { className: 'data-table', ref: tableRef, style: { tableLayout: 'fixed' } },
    e('thead', null,
      e('tr', null,
        e('th', null, ''),
        isFilterMode && e('th', null, 'Match'),
        e('th', {
          style: { position: 'relative', width: colWidths.sender, userSelect: 'none' },
          title: 'Drag right edge to resize'
        },
          e('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' } },
            'Sender',
            e('div', {
              onMouseDown: (ev) => handleResizeStart('sender', ev),
              style: {
                cursor: 'col-resize', width: 4, height: 20, margin: '0 -2px',
                background: resizing?.col === 'sender' ? 'var(--accent)' : 'transparent',
                transition: 'background 0.2s',
              }
            })
          )
        ),
        e('th', null, 'Amount'),
        e('th', {
          style: { position: 'relative', width: colWidths.memo, userSelect: 'none' },
          title: 'Drag right edge to resize'
        },
          e('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' } },
            'Memo',
            e('div', {
              onMouseDown: (ev) => handleResizeStart('memo', ev),
              style: {
                cursor: 'col-resize', width: 4, height: 20, margin: '0 -2px',
                background: resizing?.col === 'memo' ? 'var(--accent)' : 'transparent',
                transition: 'background 0.2s',
              }
            })
          )
        ),
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
        const ctx       = getMatchContext(g);
        const isLinked  = ctx.status === 'matched';  // Notes exist = linked

        return e('tr', {
          key: g.MessageId,
          style: {
            cursor: 'pointer',
            background: selectedMessageId === g.MessageId
              ? 'var(--surface2)'
              : isLinked ? 'rgba(0,200,100,0.06)' : undefined,
            opacity: (isFilterMode && ctx.time && !isLinked) ? 0.72 : 1,  // Dim if in filter mode but not linked
          },
          onClick: () => onSelect(g.MessageId === selectedMessageId ? null : g.MessageId),
        },
          e('td', null,
            e('input', { type: 'radio', checked: selectedMessageId === g.MessageId, onChange: () => onSelect(g.MessageId), onClick: ev => ev.stopPropagation() })
          ),
          isFilterMode && e('td', { style: { whiteSpace: 'nowrap' } },
            (() => {
              const ctx = getMatchContext(g);
              return e(MatchCtxBadge, { status: ctx.status, linkedTime: ctx.time });
            })()
          ),
          e('td', { style: { fontSize: 12, width: colWidths.sender, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, fmt(g.Sender)),
          e('td', null, fmtMoney(g.Amount)),
          e('td', { style: { width: colWidths.memo, overflow: 'hidden', textOverflow: 'ellipsis' } },
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
              onClick: ev => { ev.stopPropagation(); onPopoverToggle(isOpen ? null : g.MessageId); },
            }, hasMemoId ? '⚡ Quick' : '+ Create'),
          ),
        );
      })
    )
  );
};


// ---------------------------------------------------------------------------
// Payment history table
// ---------------------------------------------------------------------------

const PaymentHistoryTable = ({ payments = [] }) => {
  const e = React.createElement;
  if (!payments.length) {
    return e('div', { style: { padding: 24, textAlign: 'center', color: 'var(--text2)' } },
      'No payments found'
    );
  }
  return e('table', { className: 'data-table' },
    e('thead', null,
      e('tr', null,
        e('th', null, 'Member'),
        e('th', null, 'Amount'),
        e('th', null, 'Intent'),
        e('th', null, 'Payment Date'),
        e('th', null, 'Created'),
        e('th', null, 'Processed By'),
      )
    ),
    e('tbody', null,
      payments.map((p, i) =>
        e('tr', { key: i, style: { borderBottom: '1px solid var(--border)' } },
          e('td', null, `${p.FirstName} ${p.LastName} (${p.MemberID})`),
          e('td', null, fmtMoney(p.Amount)),
          e('td', null, p.PaymentIntent || '—'),
          e('td', null, fmtDate(p.PaymentDate)),
          e('td', { style: { fontSize: 11, color: 'var(--text2)' } }, fmtDate(p.CreatedAt)),
          e('td', { style: { fontSize: 11, color: 'var(--text2)' } }, p.ProcessedBy || 'auto'),
        )
      )
    )
  );
};


// ---------------------------------------------------------------------------
// Main PaymentsPanel component
// ---------------------------------------------------------------------------

const PaymentsPanel = () => {
  const e = React.createElement;

  const [stats,          setStats]          = useState({});
  const [pendingSubmissions, setPendingSubmissions] = useState([]);
  const [unmatchedGmail, setUnmatchedGmail] = useState([]);
  const [paymentHistory, setPaymentHistory] = useState([]);

  const [selectedSubmissionIds, setSelectedSubmissionIds] = useState(new Set());
  const [selectedMessageId, setSelectedMessageId] = useState(null);

  const [focusedSubmissionId, setFocusedSubmissionId] = useState(null);
  const [gmailCandidates, setGmailCandidates] = useState(null);
  const [candidatesLoading, setCandidatesLoading] = useState(false);

  const [toast, setToast] = useState('');
  const [loading, setLoading] = useState(false);
  const [showSubmissions, setShowSubmissions] = useState(true);
  const [showDashboard, setShowDashboard] = useState(true);
  const [showHistory, setShowHistory] = useState(true);
  const [activeGmailPopover, setActiveGmailPopover] = useState(null);

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

  const handleSubmissionFocus = useCallback((submissionId) => {
    if (focusedSubmissionId === submissionId) {
      setFocusedSubmissionId(null);
      setGmailCandidates(null);
      return;
    }
    setFocusedSubmissionId(submissionId);
    setGmailCandidates(null);
    setCandidatesLoading(true);
    api(`/api/payments/gmail-candidates/${submissionId}`).then(r => {
      setCandidatesLoading(false);
      if (r.ok) {
        const candidates = Array.isArray(r.data) ? r.data : (r.data && Array.isArray(r.data.data) ? r.data.data : []);
        setGmailCandidates(candidates);
      }
    });
  }, [focusedSubmissionId]);

  const clearSubmissionFocus = useCallback(() => {
    setFocusedSubmissionId(null);
    setGmailCandidates(null);
  }, []);

  const loadAll = useCallback(() => {
    api('/api/payments/dashboard').then(r => {
      if (r.ok) {
        // Dashboard API returns: {ok: true, pending: 4, matched: 238, unmatched_gmail: 325, ...}
        // Extract just the stats (remove the 'ok' field)
        const { ok, ...stats } = r;
        setStats(stats);
      }
    });
    api('/api/payments/pending-submissions').then(r => {
      // Response: {submissions: [...rows...]}
      const submissions = (Array.isArray(r.submissions)) ? r.submissions : [];
      setPendingSubmissions(submissions);
    });
    api('/api/payments/unmatched-gmail').then(r => {
      // Response: {transactions: [...rows...]}
      const gmail = (Array.isArray(r.transactions)) ? r.transactions : [];
      setUnmatchedGmail(gmail);
    });
    api('/api/payments/history?limit=50&days=30').then(r => {
      // Response: {payments: [...rows...]}
      const payments = (Array.isArray(r.payments)) ? r.payments : [];
      setPaymentHistory(payments);
    });
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);

  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(''), 4000); };

  const toggleSubmission = (id) => setSelectedSubmissionIds(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const selectAllSubmissions = (ids) => setSelectedSubmissionIds(new Set(ids));

  const focusedSubmission = pendingSubmissions.find(sub => sub.SubmissionID === focusedSubmissionId) || null;

  const handleQuickApproved = (messageId, memberId, intent) => {
    showToast(`✓ Approved ${intent} for ${memberId}`);
    clearSubmissionFocus();
    loadAll();
  };

  const handleAutoguess = useCallback(() => {
    setLoading(true);
    api('/api/payments/autoguess-all', { method: 'POST' }).then(r => {
      setLoading(false);
      if (r.ok) {
        const { created, skipped, errors } = r.details || {};
        const msg = `✓ Autoguess complete: ${created} created, ${skipped} skipped${errors > 0 ? `, ${errors} errors` : ''}`;
        showToast(msg);
        loadAll();
      } else {
        showToast(`✗ Autoguess failed: ${r.error || 'Unknown error'}`);
      }
    }).catch(err => {
      setLoading(false);
      showToast(`✗ Error: ${err.message}`);
    });
  }, []);

  return e('div', null,
    toast && e('div', {
      style: { position: 'fixed', top: 16, right: 16, zIndex: 200, background: 'var(--surface)', border: '1px solid var(--accent)', borderRadius: 'var(--radius)', padding: '10px 16px', fontSize: 13, boxShadow: '0 4px 12px rgba(0,0,0,0.3)' }
    }, toast),

    e(MemberTooltip, { memberId: tooltip.memberId, anchorRect: tooltip.rect, data: tooltip.data }),

    e('div', { style: { marginBottom: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center' } },
      e('h3', { style: { fontSize: 14, fontWeight: 600, margin: 0 } }, 'Dashboard'),
      e('button', {
        className: 'btn btn-sm btn-outline',
        onClick: () => setShowDashboard(v => !v),
        style: { fontSize: 11, padding: '2px 7px' },
      }, showDashboard ? '▼ Collapse' : '▶ Expand'),
    ),

    showDashboard && e(StatsCards, { stats, onAutoguess: handleAutoguess, autoguessLoading: loading }),

    e('div', { style: { display: 'flex', gap: 16, alignItems: 'flex-start', marginTop: 16 } },

      // LEFT: Submissions panel
      showSubmissions && e('div', {
        style: {
          flex: '0 0 420px', minWidth: 0, border: '1px solid var(--border)',
          borderRadius: 'var(--radius)', display: 'flex', flexDirection: 'column',
        }
      },
        e('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 12px', borderBottom: '1px solid var(--border)', background: 'var(--surface)' } },
          e('span', { style: { fontSize: 13, fontWeight: 600 } }, `Submissions (${pendingSubmissions.length})`),
        ),
        e('div', { style: { overflowY: 'auto', maxHeight: 520 } },
          e(PendingSubmissionsTable, {
            submissions: pendingSubmissions,
            selectedSubmissionIds,
            focusedSubmissionId,
            onToggle: toggleSubmission,
            onSelectAll: selectAllSubmissions,
            onViewMember: () => {},
            onFocus: handleSubmissionFocus,
            tooltipHandlers,
          }),
        ),
      ),

      // RIGHT: Gmail panel
      e('div', { style: { flex: 1, minWidth: 0, border: '1px solid var(--border)', borderRadius: 'var(--radius)', display: 'flex', flexDirection: 'column' } },
        e('div', { style: { padding: '8px 12px', borderBottom: '1px solid var(--border)', background: 'var(--surface)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 } },
          e('div', { style: { display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 } },
            e('button', {
              className: 'btn btn-sm btn-outline',
              onClick: () => setShowSubmissions(v => !v),
              title: showSubmissions ? 'Hide submissions panel' : 'Show submissions panel',
              style: { fontSize: 11, padding: '2px 7px', whiteSpace: 'nowrap' },
            }, showSubmissions ? '◀ Hide' : '▶ Show'),

            focusedSubmission
              ? e('div', { style: { display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 } },
                  e('span', { style: { fontSize: 11, color: 'var(--yellow)', fontWeight: 600 } }, '🔍 Candidates'),
                  e(MemberIdChip, { memberId: focusedSubmission.MemberID, tooltipHandlers, onClick: () => {} }),
                  e('button', { className: 'btn btn-sm btn-outline', onClick: clearSubmissionFocus, style: { fontSize: 10, padding: '1px 5px' } }, '✕'),
                )
              : e('span', { style: { fontSize: 13, fontWeight: 600 } }, `Gmail (${unmatchedGmail.length})`),
          ),
        ),
        e('div', { style: { overflowY: 'auto', maxHeight: 520 } },
          e(GmailTable, {
            rows: unmatchedGmail,
            candidates: gmailCandidates,
            focusedSubmission,
            candidatesLoading,
            selectedMessageId,
            onSelect: setSelectedMessageId,
            onQuickApproved: handleQuickApproved,
            onClearFocus: clearSubmissionFocus,
            tooltipHandlers,
            activePopover: activeGmailPopover,
            onPopoverToggle: setActiveGmailPopover,
          }),
        ),
      ),
    ),

    // Payment history section
    e('div', { style: { marginTop: 32 } },
      e('div', { style: { marginBottom: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center' } },
        e('h3', { style: { fontSize: 14, fontWeight: 600, margin: 0 } }, `Payment History (Last 30 Days)`),
        e('button', {
          className: 'btn btn-sm btn-outline',
          onClick: () => setShowHistory(v => !v),
          style: { fontSize: 11, padding: '2px 7px' },
        }, showHistory ? '▼ Collapse' : '▶ Expand'),
      ),
      showHistory && e('div', { style: { border: '1px solid var(--border)', borderRadius: 'var(--radius)', overflowY: 'auto', maxHeight: 400 } },
        e(PaymentHistoryTable, { payments: paymentHistory })
      ),
    ),

    // Popover for quick-approve (rendered at root level so it appears on top)
    activeGmailPopover && unmatchedGmail && unmatchedGmail.find(g => g.MessageId === activeGmailPopover) && e(GmailQuickApprovePopover, {
      gmail: unmatchedGmail.find(g => g.MessageId === activeGmailPopover),
      onClose: () => setActiveGmailPopover(null),
      tooltipHandlers,
      onApproved: (mid, intent) => { setActiveGmailPopover(null); handleQuickApproved(activeGmailPopover, mid, intent); },
    }),
  );
};

window.PaymentsPanel = PaymentsPanel;
