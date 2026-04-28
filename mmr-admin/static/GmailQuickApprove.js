/**
 * GmailQuickApprove.js — Gmail quick-approve popover and context utilities.
 *
 * Components:
 *   - GmailQuickApprovePopover: Fixed-position popover for manual member + intent selection
 *   - getMatchContext: Helper to determine payment match status from gmail.Notes
 *   - MatchCtxBadge: Inline badge showing match status (LINKED, CANDIDATE, etc)
 *
 * Must be loaded BEFORE PaymentsPanel.js in index.html.
 * Depends on: PaymentsHelpers, MemberTooltip (for extractMemberIds, suggestIntent, fuzzyMatchMember, fmtMoney, fmtDate)
 *
 * Exported to: window.GmailQuickApprovePopover, window.getMatchContext, window.MatchCtxBadge
 */

/* global React, useState, useEffect, useRef, api */

(function() {
  const { extractMemberIds, suggestIntent, fmtMoney, fmtDate, PAYMENT_INTENTS } = window.PaymentsHelpers;
  const { fuzzyMatchMember } = window;

  const GmailQuickApprovePopover = ({ gmail, anchorRect, onClose, onApproved, tooltipHandlers }) => {
    const memoIds = extractMemberIds((gmail.Memo || '') + ' ' + (gmail.OriginalMemo || ''));
    const [memberId, setMemberId] = useState(memoIds[0] || '');
    const [intent, setIntent] = useState(suggestIntent(gmail.Amount));
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [memberData, setMemberData] = useState(null);
    const [memberLoading, setMemberLoading] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [allMembers, setAllMembers] = useState([]);
    const [membersLoaded, setMembersLoaded] = useState(false);
    const [searchResults, setSearchResults] = useState([]);
    const [extraIds, setExtraIds] = useState([]); // IDs added via search, not in memo
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
      const newId = member.MemberID;
      setMemberId(newId);
      setSearchQuery('');
      setSearchResults([]);
      // Add to dropdown if not already present from memo or previous searches
      if (!memoIds.includes(newId) && !extraIds.includes(newId)) {
        setExtraIds(prev => [...prev, newId]);
      }
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
      style: (() => {
        const w = 360;
        let top  = anchorRect ? anchorRect.bottom + 4 : 100;
        let left = anchorRect ? anchorRect.right - w  : 100;
        if (left < 8) left = 8;
        if (left + w > window.innerWidth - 8) left = window.innerWidth - w - 8;
        if (top + 420 > window.innerHeight - 8) top = (anchorRect ? anchorRect.top - 420 : top);
        return {
          position: 'fixed', zIndex: 9999, top, left, width: w,
          background: 'var(--surface)', border: '1px solid var(--accent)',
          borderRadius: 'var(--radius)', padding: 16,
          boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
        };
      })(),
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
        (() => {
          const allIds = [...memoIds, ...extraIds];
          return allIds.length > 0
            ? e('select', {
                value: memberId,
                onChange: ev => setMemberId(ev.target.value),
                style: { width: '100%', background: 'var(--bg)', border: '1px solid var(--border)', color: 'var(--text)', padding: '6px 8px', borderRadius: 'var(--radius)', fontSize: 13 },
              },
              allIds.map(id => e('option', { key: id, value: id }, id)),
              e('option', { value: '' }, '— Enter manually —'),
            )
            : null;
        })(),
        (memoIds.length === 0 && extraIds.length === 0 || memberId === '') && e('input', {
          placeholder: 'e.g. A0123',
          value: (memoIds.length === 0 && extraIds.length === 0) ? memberId : '',
          onChange: ev => setMemberId(ev.target.value),
          style: { width: '100%', marginTop: (memoIds.length > 0 || extraIds.length > 0) ? 6 : 0, background: 'var(--bg)', border: '1px solid var(--border)', color: 'var(--text)', padding: '6px 8px', borderRadius: 'var(--radius)', fontSize: 13, boxSizing: 'border-box' },
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

  const getMatchContext = (gmail) => {
    if (gmail.Notes && gmail.Notes.trim()) {
      return { status: 'matched', time: gmail.UpdatedAt };
    }
    return { status: 'candidate', time: null };
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

  window.GmailQuickApprovePopover = GmailQuickApprovePopover;
  window.getMatchContext = getMatchContext;
  window.MatchCtxBadge = MatchCtxBadge;
})();
