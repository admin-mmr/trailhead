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
 * Core component orchestrating data fetching, state, and layout.
 * Sub-components extracted to: PaymentsHelpers, MemberTooltip, GmailQuickApprove, PaymentsSubPanels.
 *
 * Loaded as <script> in index.html; uses global `api()` helper and React globals.
 */

/* global React, useState, useEffect, useCallback, useRef, api */

const PaymentsPanel = () => {
  const { MemberTooltip, StatsCards, PendingSubmissionsTable, GmailTable, PaymentHistoryTable, GmailQuickApprovePopover } = window;
  const { _memberCache } = window;
  const e = React.createElement;

  const [stats,          setStats]          = useState({});
  const [pendingSubmissions, setPendingSubmissions] = useState([]);
  const [unmatchedGmail, setUnmatchedGmail] = useState([]);
  const [paymentHistory, setPaymentHistory] = useState([]);

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
  const [popoverAnchorRect, setPopoverAnchorRect] = useState(null);
  const [gmailSearch, setGmailSearch] = useState('');
  const [gmailTotal, setGmailTotal] = useState(0);
  const [gmailLoadingMore, setGmailLoadingMore] = useState(false);
  const GMAIL_PAGE = 50;

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
      if (r && Array.isArray(r.candidates)) {
        setGmailCandidates(r.candidates);
      } else if (r && r.error) {
        setGmailCandidates([]);
      }
    });
  }, [focusedSubmissionId]);

  const clearSubmissionFocus = useCallback(() => {
    setFocusedSubmissionId(null);
    setGmailCandidates(null);
  }, []);

  const loadGmail = useCallback((search = '', skip = 0, append = false) => {
    const qs = new URLSearchParams({ limit: GMAIL_PAGE, skip, ...(search ? { search } : {}) });
    if (!append) setUnmatchedGmail([]);
    else setGmailLoadingMore(true);
    api(`/api/payments/unmatched-gmail?${qs}`).then(r => {
      const rows = Array.isArray(r.transactions) ? r.transactions : [];
      setUnmatchedGmail(prev => append ? [...prev, ...rows] : rows);
      setGmailTotal(r.total || 0);
      setGmailLoadingMore(false);
    });
  }, []);

  useEffect(() => {
    const t = setTimeout(() => loadGmail(gmailSearch, 0, false), 300);
    return () => clearTimeout(t);
  }, [gmailSearch, loadGmail]);

  const colFilterTimerRef = React.useRef(null);
  const handleColFilter = useCallback((filters) => {
    // Merge non-empty column filters into a server search term
    const term = [filters.sender, filters.amount, filters.memo, filters.txnum].filter(Boolean).join(' ').trim();
    clearTimeout(colFilterTimerRef.current);
    colFilterTimerRef.current = setTimeout(() => loadGmail(term, 0, false), 350);
  }, [loadGmail]);

  const loadAll = useCallback(() => {
    api('/api/payments/dashboard').then(r => {
      if (r.ok) {
        const { ok, ...stats } = r;
        setStats(stats);
      }
    });
    api('/api/payments/pending-submissions').then(r => {
      const submissions = Array.isArray(r.submissions) ? r.submissions : [];
      setPendingSubmissions(submissions);
    });
    loadGmail('', 0, false);
    api('/api/payments/history?limit=50&days=30').then(r => {
      const payments = Array.isArray(r.payments) ? r.payments : [];
      setPaymentHistory(payments);
    });
  }, [loadGmail]);

  useEffect(() => { loadAll(); }, [loadAll]);

  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(''), 4000); };


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

    e('div', { className: 'payments-layout', style: { display: 'flex', gap: 16, alignItems: 'flex-start', marginTop: 16 } },

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
            focusedSubmissionId,
            onViewMember: () => {},
            onFocus: handleSubmissionFocus,
            tooltipHandlers,
          }),
        ),
      ),

      // RIGHT: Gmail panel
      e('div', { style: { flex: 1, minWidth: 0, border: '1px solid var(--border)', borderRadius: 'var(--radius)', display: 'flex', flexDirection: 'column' } },
        // Header row
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
                  e(window.MemberIdChip, { memberId: focusedSubmission.MemberID, tooltipHandlers, onClick: () => {} }),
                  e('button', { className: 'btn btn-sm btn-outline', onClick: clearSubmissionFocus, style: { fontSize: 10, padding: '1px 5px' } }, '✕'),
                )
              : e('span', { style: { fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap' } },
                  `Gmail (${unmatchedGmail.length}${gmailTotal > unmatchedGmail.length ? ` of ${gmailTotal}` : ''})`),
          ),
          // Search box — hidden in candidate filter mode
          !focusedSubmission && e('input', {
            type: 'search',
            placeholder: 'Search sender, memo, amount, tx#…',
            value: gmailSearch,
            onChange: ev => setGmailSearch(ev.target.value),
            style: {
              fontSize: 12, padding: '3px 8px', borderRadius: 4,
              border: '1px solid var(--border)', background: 'var(--surface2)',
              color: 'var(--text)', width: 230, outline: 'none',
            },
          }),
        ),
        // Table
        e('div', { style: { overflowY: 'auto', flex: 1, maxHeight: 520 } },
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
            onPopoverToggle: (id, rect) => { setActiveGmailPopover(id); setPopoverAnchorRect(rect || null); },
            onColFilter: handleColFilter,
          }),
          // Load More
          !focusedSubmission && unmatchedGmail.length < gmailTotal && e('div', {
            style: { padding: '10px 0', textAlign: 'center', borderTop: '1px solid var(--border)' }
          },
            e('button', {
              className: 'btn btn-sm btn-outline',
              disabled: gmailLoadingMore,
              onClick: () => loadGmail(gmailSearch, unmatchedGmail.length, true),
              style: { fontSize: 12 },
            }, gmailLoadingMore ? 'Loading…' : `Load more (${gmailTotal - unmatchedGmail.length} remaining)`),
          ),
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
        e(PaymentHistoryTable, {
          payments: paymentHistory,
          onCancel: async (paymentId) => {
            const r = await api(`/api/payments/cancel/${paymentId}`, { method: 'POST' });
            if (r.ok) {
              showToast(`✅ ${r.message}`);
              const refreshed = await api('/api/payments/history?limit=50&days=30');
              if (refreshed.payments) setPaymentHistory(refreshed.payments);
            } else {
              showToast(`❌ Cancel failed: ${r.error || 'Unknown error'}`);
            }
          },
        })
      ),
    ),

    // Popover for quick-approve (rendered at root level so it appears on top)
    activeGmailPopover && unmatchedGmail && unmatchedGmail.find(g => g.MessageId === activeGmailPopover) && e(GmailQuickApprovePopover, {
      gmail: unmatchedGmail.find(g => g.MessageId === activeGmailPopover),
      anchorRect: popoverAnchorRect,
      onClose: () => { setActiveGmailPopover(null); setPopoverAnchorRect(null); },
      tooltipHandlers,
      onApproved: (mid, intent) => { setActiveGmailPopover(null); setPopoverAnchorRect(null); handleQuickApproved(activeGmailPopover, mid, intent); },
    }),
  );
};

window.PaymentsPanel = PaymentsPanel;
