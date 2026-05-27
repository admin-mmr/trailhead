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
  const { MemberTooltip, PendingSubmissionsTable, GmailTable, PaymentHistoryTable, GmailQuickApprovePopover } = window;
  const { _memberCache } = window;
  const e = React.createElement;

  const [pendingSubmissions, setPendingSubmissions] = useState([]);
  const [unmatchedGmail, setUnmatchedGmail] = useState([]);
  const [paymentHistory, setPaymentHistory] = useState([]);
  const [historySearch, setHistorySearch] = useState('');
  const [historyDays, setHistoryDays] = useState(30);
  const [historyTotal, setHistoryTotal] = useState(0);
  const [historyLoadingMore, setHistoryLoadingMore] = useState(false);

  const [selectedMessageId, setSelectedMessageId] = useState(null);

  const [focusedSubmissionId, setFocusedSubmissionId] = useState(null);
  const [gmailCandidates, setGmailCandidates] = useState(null);
  const [candidatesLoading, setCandidatesLoading] = useState(false);

  const [toast, setToast] = useState('');
  const [loading, setLoading] = useState(false);
  const [showSubmissions, setShowSubmissions] = useState(true);
  const [showHistory, setShowHistory] = useState(true);

  // Gmail sync bar state
  const [lastSyncTime, setLastSyncTime] = useState(null);
  const [syncJobId, setSyncJobId]       = useState(null);
  const [syncStatus, setSyncStatus]     = useState(null); // null | 'running' | 'done' | 'error'
  const stopPollRef = useRef(null);  // holds cleanup fn returned by pollUntilDone
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

  // ── Gmail sync bar helpers ────────────────────────────────────────────────
  const fetchLastSync = useCallback(() => {
    api('/api/sync/last-import').then(r => {
      if (r && r.completedAt) setLastSyncTime(r.completedAt);
    });
  }, []);

  const pollSyncJob = useCallback((jobId) => {
    if (stopPollRef.current) stopPollRef.current();
    stopPollRef.current = window.pollUntilDone(jobId, {
      onDone: () => {
        setSyncStatus('done');
        fetchLastSync();
        loadAll();
        setTimeout(() => setSyncStatus(null), 4000);
      },
      onError: () => {
        setSyncStatus('error');
        setTimeout(() => setSyncStatus(null), 4000);
      },
    });
  }, [fetchLastSync]);

  const handleSyncNow = useCallback(() => {
    setSyncStatus('running');
    api('/api/sync/import/transactions', { method: 'POST' }).then(r => {
      if (r && r.job_id) {
        setSyncJobId(r.job_id);
        pollSyncJob(r.job_id);
      } else {
        setSyncStatus('error');
        setTimeout(() => setSyncStatus(null), 4000);
      }
    });
  }, [pollSyncJob]);

  useEffect(() => { fetchLastSync(); return () => { if (stopPollRef.current) stopPollRef.current(); }; }, [fetchLastSync]);

  // Inject pulse keyframe once (no JSX, no external CSS dependency)
  useEffect(() => {
    if (!document.getElementById('stale-pulse-style')) {
      const s = document.createElement('style');
      s.id = 'stale-pulse-style';
      s.textContent = '@keyframes stale-pulse{0%,100%{opacity:1}50%{opacity:0.55}}';
      document.head.appendChild(s);
    }
  }, []);

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

  const loadHistory = useCallback((search = '', days = 30, skip = 0, append = false) => {
    const qs = new URLSearchParams({ limit: 50, days, skip, ...(search ? { search } : {}) });
    if (append) setHistoryLoadingMore(true);
    api(`/api/payments/history?${qs}`).then(r => {
      const rows = Array.isArray(r.payments) ? r.payments : [];
      setPaymentHistory(prev => append ? [...prev, ...rows] : rows);
      setHistoryTotal(r.total || 0);
      setHistoryLoadingMore(false);
    });
  }, []);

  useEffect(() => {
    const t = setTimeout(() => loadGmail(gmailSearch, 0, false), 300);
    return () => clearTimeout(t);
  }, [gmailSearch, loadGmail]);

  useEffect(() => {
    const t = setTimeout(() => loadHistory(historySearch, historyDays, 0, false), 300);
    return () => clearTimeout(t);
  }, [historySearch, historyDays, loadHistory]);

  const colFilterTimerRef = React.useRef(null);
  const handleColFilter = useCallback((filters) => {
    // Merge non-empty column filters into a server search term
    const term = [filters.sender, filters.amount, filters.memo, filters.txnum].filter(Boolean).join(' ').trim();
    clearTimeout(colFilterTimerRef.current);
    colFilterTimerRef.current = setTimeout(() => loadGmail(term, 0, false), 350);
  }, [loadGmail]);

  const loadAll = useCallback(() => {
    api('/api/payments/pending-submissions').then(r => {
      const submissions = Array.isArray(r.submissions) ? r.submissions : [];
      setPendingSubmissions(submissions);
    });
    loadGmail('', 0, false);
    loadHistory('', 30, 0, false);
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

  // Gmail sync status bar
  const syncBarColor = syncStatus === 'completed' ? 'var(--green, #22c55e)' : syncStatus === 'error' ? '#dc2626' : 'var(--accent)';
  const syncBarLabel = syncStatus === 'running'   ? '⏳ Syncing…'
                     : syncStatus === 'completed' ? '✓ Sync complete'
                     : syncStatus === 'error'     ? '✗ Sync failed'
                     : 'Sync Now';

  // completedAt from backend is Unix seconds (time.time()); multiply by 1000 for JS Date.
  const toMs = (ts) => !ts ? null : (ts > 1e12 ? ts : ts * 1000);

  const fmtSyncTime = (ts) => {
    const ms = toMs(ts);
    if (!ms) return 'Never';
    return new Date(ms).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  };

  const lastSyncMs = toMs(lastSyncTime);

  const STALE_HOURS = 24;
  const isStale = !lastSyncMs || (Date.now() - lastSyncMs) > STALE_HOURS * 3_600_000;
  const hoursOld = lastSyncMs ? Math.round((Date.now() - lastSyncMs) / 3_600_000) : null;

  return e('div', null,
    toast && e('div', {
      style: { position: 'fixed', top: 16, right: 16, zIndex: 200, background: 'var(--surface)', border: '1px solid var(--accent)', borderRadius: 'var(--radius)', padding: '10px 16px', fontSize: 13, boxShadow: '0 4px 12px rgba(0,0,0,0.3)' }
    }, toast),

    e(MemberTooltip, { memberId: tooltip.memberId, anchorRect: tooltip.rect, data: tooltip.data }),

    // Stale-sync warning banner
    isStale && e('div', {
      style: {
        display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10,
        padding: '10px 14px', borderRadius: 'var(--radius)',
        background: '#fffbea', border: '1px solid #f59e0b', fontSize: 13,
      }
    },
      e('span', { style: { color: '#b45309', fontWeight: 600 } }, '⚠️ Gmail data is stale'),
      e('span', { style: { color: '#78350f', fontSize: 12 } },
        hoursOld !== null
          ? `Last sync was ${hoursOld}h ago — sync before running Autoguess.`
          : 'No sync on record — sync Gmail transactions first.'
      ),
      e('button', {
        className: 'btn btn-sm',
        onClick: handleSyncNow,
        disabled: syncStatus === 'running',
        style: {
          marginLeft: 'auto', fontSize: 12, fontWeight: 700,
          background: '#f59e0b', color: '#fff', border: 'none',
          borderRadius: 'var(--radius)', padding: '5px 14px',
          cursor: syncStatus === 'running' ? 'not-allowed' : 'pointer',
          animation: syncStatus === 'running' ? 'none' : 'stale-pulse 1.6s ease-in-out infinite',
        },
      }, syncStatus === 'running' ? '⏳ Syncing…' : '📥 Sync Now'),
    ),

    // Gmail sync bar
    e('div', {
      style: {
        display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16,
        padding: '8px 14px', borderRadius: 'var(--radius)',
        background: 'var(--surface)', border: '1px solid var(--border)', fontSize: 13,
      }
    },
      e('span', { style: { color: 'var(--text2)' } }, '📥 Gmail Transactions'),
      e('span', { style: { color: 'var(--text2)', fontSize: 12 } },
        'Last imported: ', e('strong', { style: { color: 'var(--text)' } }, fmtSyncTime(lastSyncTime)),
      ),
      e('button', {
        className: 'btn btn-sm',
        onClick: handleSyncNow,
        disabled: syncStatus === 'running',
        style: {
          marginLeft: 'auto', fontSize: 12, fontWeight: 600,
          background: syncStatus ? syncBarColor : 'var(--accent)',
          color: '#fff', border: 'none', borderRadius: 'var(--radius)',
          padding: '5px 14px', cursor: syncStatus === 'running' ? 'not-allowed' : 'pointer',
          opacity: syncStatus === 'running' ? 0.7 : 1,
        },
      }, syncBarLabel),
      e('button', {
        className: 'btn btn-sm',
        onClick: handleAutoguess,
        disabled: loading || isStale,
        title: isStale
          ? '⚠️ Sync Gmail transactions first — data is more than 24h old'
          : 'Automatically match transactions with explicit memberID in memo',
        style: {
          fontSize: 12, fontWeight: 600,
          background: 'var(--accent)', color: '#fff', border: 'none',
          borderRadius: 'var(--radius)', padding: '5px 14px',
          cursor: (loading || isStale) ? 'not-allowed' : 'pointer',
          opacity: (loading || isStale) ? 0.4 : 1,
        },
      }, loading ? '⏳ Autoguessing…' : '🤖 Autoguess'),
    ),

    e('div', { className: 'payments-layout', style: { display: 'flex', gap: 16, alignItems: 'flex-start' } },

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
      e('div', { style: { marginBottom: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center' } },
        e('h3', { style: { fontSize: 14, fontWeight: 600, margin: 0 } },
          `Payment History`,
          historyTotal > 0
            ? e('span', { style: { fontWeight: 400, color: 'var(--text2)', marginLeft: 6, fontSize: 12 } },
                `${paymentHistory.length} of ${historyTotal}`)
            : null,
        ),
        e('button', {
          className: 'btn btn-sm btn-outline',
          onClick: () => setShowHistory(v => !v),
          style: { fontSize: 11, padding: '2px 7px' },
        }, showHistory ? '▼ Collapse' : '▶ Expand'),
      ),
      showHistory && e('div', { style: { marginBottom: 8, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' } },
        e('input', {
          type: 'text',
          placeholder: 'Search member name, ID, or payment ID…',
          value: historySearch,
          onChange: ev => setHistorySearch(ev.target.value),
          style: { flex: 1, minWidth: 220, padding: '4px 8px', border: '1px solid var(--border)', borderRadius: 4, fontSize: 13 },
        }),
        e('select', {
          value: historyDays,
          onChange: ev => setHistoryDays(Number(ev.target.value)),
          style: { padding: '4px 8px', border: '1px solid var(--border)', borderRadius: 4, fontSize: 13 },
        },
          e('option', { value: 30 }, 'Last 30 days'),
          e('option', { value: 90 }, 'Last 90 days'),
          e('option', { value: 365 }, 'Last year'),
          e('option', { value: 0 }, 'All time'),
        ),
      ),
      showHistory && e('div', { style: { border: '1px solid var(--border)', borderRadius: 'var(--radius)', overflowY: 'auto', maxHeight: 400 } },
        e(PaymentHistoryTable, {
          payments: paymentHistory,
          onCancel: async (paymentId) => {
            const r = await api(`/api/payments/cancel/${paymentId}`, { method: 'POST' });
            if (r.ok) {
              showToast(`✅ ${r.message}`);
              loadHistory(historySearch, historyDays, 0, false);
            } else {
              showToast(`❌ Cancel failed: ${r.error || 'Unknown error'}`);
            }
          },
        })
      ),
      showHistory && paymentHistory.length > 0 && paymentHistory.length < historyTotal && e('div', { style: { marginTop: 8, textAlign: 'center' } },
        e('button', {
          className: 'btn btn-sm btn-outline',
          disabled: historyLoadingMore,
          onClick: () => loadHistory(historySearch, historyDays, paymentHistory.length, true),
        }, historyLoadingMore ? 'Loading…' : `Load more (${historyTotal - paymentHistory.length} remaining)`),
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
