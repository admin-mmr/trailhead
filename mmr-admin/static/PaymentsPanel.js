/**
 * PaymentsPanel — React component for the Payments tab in mmr-admin.
 *
 * Core component orchestrating data fetching, state, and the side-by-side
 * reconcile layout (pending submissions left, gmail_transactions right).
 * Presentational sections + tables are extracted to: PaymentsHelpers,
 * MemberTooltip, GmailQuickApprove, PaymentsSubPanels, PaymentsGmailTable,
 * PaymentsPanelParts (PaymentsSyncBar / PaymentsReconcileView / PaymentHistorySection).
 *
 * Loaded as <script> in index.html; uses global `api()` helper and React globals.
 */

/* global React, useState, useEffect, useCallback, useRef, api */

const PaymentsPanel = () => {
  const { MemberTooltip, GmailQuickApprovePopover } = window;
  const { PaymentsSyncBar, PaymentsReconcileView, PaymentHistorySection } = window;
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
  const [syncStatus, setSyncStatus]     = useState(null); // null | 'running' | 'done' | 'error'
  const [syncStep, setSyncStep]         = useState(null); // 'transactions' | 'members'
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

  // Launch one import job and resolve when it completes (rejects on error/expiry).
  const runImportJob = useCallback((endpoint) => new Promise((resolve, reject) => {
    api(endpoint, { method: 'POST' }).then(r => {
      if (!r || !r.job_id) {
        reject(new Error((r && r.error) || `Failed to launch ${endpoint}`));
        return;
      }
      if (stopPollRef.current) stopPollRef.current();
      stopPollRef.current = window.pollUntilDone(r.job_id, {
        onDone: resolve,
        onError: (job) => reject(new Error((job && job.message) || 'Sync failed')),
      });
    }).catch(reject);
  }), []);

  // Sync = Gmail transactions import, then new-member import (both Sheets → MySQL).
  const handleSyncNow = useCallback(() => {
    setSyncStatus('running');
    setSyncStep('transactions');
    runImportJob('/api/sync/import/transactions')
      .then(() => {
        setSyncStep('members');
        return runImportJob('/api/sync/import/members');
      })
      .then(() => {
        setSyncStatus('done');
        setSyncStep(null);
        fetchLastSync();
        loadAll();
        setTimeout(() => setSyncStatus(null), 4000);
      })
      .catch(() => {
        setSyncStatus('error');
        setSyncStep(null);
        setTimeout(() => setSyncStatus(null), 4000);
      });
  }, [runImportJob, fetchLastSync]);

  // On the first Payments view of a page load, kick off the import sequence
  // automatically (guarded so tab switches back here don't re-trigger it).
  useEffect(() => {
    fetchLastSync();
    if (!window.__paymentsAutoSyncStarted) {
      window.__paymentsAutoSyncStarted = true;
      handleSyncNow();
    }
    return () => { if (stopPollRef.current) stopPollRef.current(); };
  }, [fetchLastSync, handleSyncNow]);

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

  return e('div', null,
    toast && e('div', {
      style: { position: 'fixed', top: 16, right: 16, zIndex: 200, background: 'var(--surface)', border: '1px solid var(--accent)', borderRadius: 'var(--radius)', padding: '10px 16px', fontSize: 13, boxShadow: '0 4px 12px rgba(0,0,0,0.3)' }
    }, toast),

    e(MemberTooltip, { memberId: tooltip.memberId, anchorRect: tooltip.rect, data: tooltip.data }),

    e(PaymentsSyncBar, {
      lastSyncTime, syncStatus, syncStep, loading,
      onSyncNow: handleSyncNow,
      onAutoguess: handleAutoguess,
    }),

    e(PaymentsReconcileView, {
      showSubmissions,
      onToggleSubmissions: () => setShowSubmissions(v => !v),
      pendingSubmissions,
      focusedSubmissionId,
      focusedSubmission,
      onSubmissionFocus: handleSubmissionFocus,
      onClearFocus: clearSubmissionFocus,
      tooltipHandlers,
      unmatchedGmail,
      gmailTotal,
      gmailSearch,
      onGmailSearch: setGmailSearch,
      gmailCandidates,
      candidatesLoading,
      selectedMessageId,
      onSelectMessage: setSelectedMessageId,
      onQuickApproved: handleQuickApproved,
      activeGmailPopover,
      onPopoverToggle: (id, rect) => { setActiveGmailPopover(id); setPopoverAnchorRect(rect || null); },
      onColFilter: handleColFilter,
      gmailLoadingMore,
      onLoadMoreGmail: () => loadGmail(gmailSearch, unmatchedGmail.length, true),
    }),

    e(PaymentHistorySection, {
      paymentHistory,
      historyTotal,
      showHistory,
      onToggleHistory: () => setShowHistory(v => !v),
      historySearch,
      onHistorySearch: setHistorySearch,
      historyDays,
      onHistoryDays: setHistoryDays,
      historyLoadingMore,
      onLoadMoreHistory: () => loadHistory(historySearch, historyDays, paymentHistory.length, true),
      onCancelPayment: async (paymentId) => {
        const r = await api(`/api/payments/cancel/${paymentId}`, { method: 'POST' });
        if (r.ok) {
          showToast(`✅ ${r.message}`);
          loadHistory(historySearch, historyDays, 0, false);
        } else {
          showToast(`❌ Cancel failed: ${r.error || 'Unknown error'}`);
        }
      },
    }),

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
