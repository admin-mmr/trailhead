/**
 * PaymentsPanelParts.js — Presentational sections extracted from PaymentsPanel.js
 * (code-health split). PaymentsPanel keeps all state/data fetching and passes
 * data + callbacks down as props.
 *
 * Components:
 *   - PaymentsSyncBar: stale-data banner + Gmail sync bar + Autoguess button
 *   - PaymentsReconcileView: side-by-side submissions (left) + Gmail (right) panels
 *   - PaymentHistorySection: collapsible payment history with search/day filters
 *
 * Must be loaded BEFORE PaymentsPanel.js in index.html.
 * Depends on globals: PendingSubmissionsTable, GmailTable, PaymentHistoryTable,
 *                     MemberIdChip, and the `api()` helper.
 *
 * Exported to: window.PaymentsSyncBar, window.PaymentsReconcileView, window.PaymentHistorySection
 */

/* global React, useEffect, api */

(function() {
  const e = React.createElement;

  // ── Stale banner + Gmail sync bar + Autoguess ────────────────────────────
  const PaymentsSyncBar = ({ lastSyncTime, syncStatus, syncStep, loading, onSyncNow, onAutoguess }) => {
    // Inject pulse keyframe once (no JSX, no external CSS dependency)
    useEffect(() => {
      if (!document.getElementById('stale-pulse-style')) {
        const s = document.createElement('style');
        s.id = 'stale-pulse-style';
        s.textContent = '@keyframes stale-pulse{0%,100%{opacity:1}50%{opacity:0.55}}';
        document.head.appendChild(s);
      }
    }, []);

    const syncBarColor = syncStatus === 'done' ? 'var(--green, #22c55e)' : syncStatus === 'error' ? '#dc2626' : 'var(--accent)';
    const syncBarLabel = syncStatus === 'running' ? (syncStep === 'members' ? '⏳ Importing new members…' : '⏳ Syncing Gmail…')
                       : syncStatus === 'done'    ? '✓ Sync complete'
                       : syncStatus === 'error'   ? '✗ Sync failed'
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

    return e(React.Fragment, null,
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
          onClick: onSyncNow,
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
        e('span', { style: { color: 'var(--text2)' } }, '📥 Gmail Transactions + New Members'),
        e('span', { style: { color: 'var(--text2)', fontSize: 12 } },
          'Last imported: ', e('strong', { style: { color: 'var(--text)' } }, fmtSyncTime(lastSyncTime)),
        ),
        e('button', {
          className: 'btn btn-sm',
          onClick: onSyncNow,
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
          onClick: onAutoguess,
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
    );
  };

  // ── Side-by-side submissions (left) + Gmail (right) ──────────────────────
  const PaymentsReconcileView = (props) => {
    const {
      showSubmissions, onToggleSubmissions,
      pendingSubmissions, focusedSubmissionId, focusedSubmission,
      onSubmissionFocus, onClearFocus, tooltipHandlers,
      unmatchedGmail, gmailTotal, gmailSearch, onGmailSearch,
      gmailCandidates, candidatesLoading, selectedMessageId, onSelectMessage,
      onQuickApproved, activeGmailPopover, onPopoverToggle, onColFilter,
      gmailLoadingMore, onLoadMoreGmail,
    } = props;
    const { PendingSubmissionsTable, GmailTable } = window;

    return e('div', { className: 'payments-layout', style: { display: 'flex', gap: 16, alignItems: 'flex-start' } },

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
            onFocus: onSubmissionFocus,
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
              onClick: onToggleSubmissions,
              title: showSubmissions ? 'Hide submissions panel' : 'Show submissions panel',
              style: { fontSize: 11, padding: '2px 7px', whiteSpace: 'nowrap' },
            }, showSubmissions ? '◀ Hide' : '▶ Show'),
            focusedSubmission
              ? e('div', { style: { display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 } },
                  e('span', { style: { fontSize: 11, color: 'var(--yellow)', fontWeight: 600 } }, '🔍 Candidates'),
                  e(window.MemberIdChip, { memberId: focusedSubmission.MemberID, tooltipHandlers, onClick: () => {} }),
                  e('button', { className: 'btn btn-sm btn-outline', onClick: onClearFocus, style: { fontSize: 10, padding: '1px 5px' } }, '✕'),
                )
              : e('span', { style: { fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap' } },
                  `Gmail (${unmatchedGmail.length}${gmailTotal > unmatchedGmail.length ? ` of ${gmailTotal}` : ''})`),
          ),
          // Search box — hidden in candidate filter mode
          !focusedSubmission && e('input', {
            type: 'search',
            placeholder: 'Search sender, memo, amount, tx#…',
            value: gmailSearch,
            onChange: ev => onGmailSearch(ev.target.value),
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
            onSelect: onSelectMessage,
            onQuickApproved,
            onClearFocus,
            tooltipHandlers,
            activePopover: activeGmailPopover,
            onPopoverToggle,
            onColFilter,
          }),
          // Load More
          !focusedSubmission && unmatchedGmail.length < gmailTotal && e('div', {
            style: { padding: '10px 0', textAlign: 'center', borderTop: '1px solid var(--border)' }
          },
            e('button', {
              className: 'btn btn-sm btn-outline',
              disabled: gmailLoadingMore,
              onClick: onLoadMoreGmail,
              style: { fontSize: 12 },
            }, gmailLoadingMore ? 'Loading…' : `Load more (${gmailTotal - unmatchedGmail.length} remaining)`),
          ),
        ),
      ),
    );
  };

  // ── Collapsible payment history ──────────────────────────────────────────
  const PaymentHistorySection = (props) => {
    const {
      paymentHistory, historyTotal, showHistory, onToggleHistory,
      historySearch, onHistorySearch, historyDays, onHistoryDays,
      historyLoadingMore, onLoadMoreHistory, onCancelPayment,
    } = props;
    const { PaymentHistoryTable } = window;

    return e('div', { style: { marginTop: 32 } },
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
          onClick: onToggleHistory,
          style: { fontSize: 11, padding: '2px 7px' },
        }, showHistory ? '▼ Collapse' : '▶ Expand'),
      ),
      showHistory && e('div', { style: { marginBottom: 8, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' } },
        e('input', {
          type: 'text',
          placeholder: 'Search member name, ID, or payment ID…',
          value: historySearch,
          onChange: ev => onHistorySearch(ev.target.value),
          style: { flex: 1, minWidth: 220, padding: '4px 8px', border: '1px solid var(--border)', borderRadius: 4, fontSize: 13 },
        }),
        e('select', {
          value: historyDays,
          onChange: ev => onHistoryDays(Number(ev.target.value)),
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
          onCancel: onCancelPayment,
        })
      ),
      showHistory && paymentHistory.length > 0 && paymentHistory.length < historyTotal && e('div', { style: { marginTop: 8, textAlign: 'center' } },
        e('button', {
          className: 'btn btn-sm btn-outline',
          disabled: historyLoadingMore,
          onClick: onLoadMoreHistory,
        }, historyLoadingMore ? 'Loading…' : `Load more (${historyTotal - paymentHistory.length} remaining)`),
      ),
    );
  };

  window.PaymentsSyncBar = PaymentsSyncBar;
  window.PaymentsReconcileView = PaymentsReconcileView;
  window.PaymentHistorySection = PaymentHistorySection;
})();
