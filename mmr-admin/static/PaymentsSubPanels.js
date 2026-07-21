/**
 * PaymentsSubPanels.js — Data tables for Payments UI.
 *
 * Components:
 *   - StatsCards: Dashboard stats grid with autoguess button
 *   - PendingSubmissionsTable: Left-side submissions list (toggleable)
 *   - PaymentHistoryTable: Approved payments list
 *
 * GmailTable lives in PaymentsGmailTable.js (code-health split).
 *
 * Must be loaded BEFORE PaymentsPanel.js in index.html.
 * Depends on: PaymentsHelpers, MemberTooltip, GmailQuickApprove (for helpers, components, utilities)
 *
 * Exported to: window.StatsCards, window.PendingSubmissionsTable, window.PaymentHistoryTable
 */

/* global React, useState, useEffect, useRef */

(function() {
  const { fmt, fmtDate, fmtMoney, Badge } = window.PaymentsHelpers;

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

  const PendingSubmissionsTable = ({ submissions, focusedSubmissionId, onViewMember, onFocus, tooltipHandlers }) => {
    const e = React.createElement;
    if (!submissions.length) {
      return e('div', { className: 'empty', style: { padding: 24, textAlign: 'center' } },
        e('div', { className: 'big' }, '✓'), 'No pending submissions'
      );
    }

    return e('table', { className: 'data-table' },
      e('thead', null,
        e('tr', null,
          e('th', null, 'Member'),
          e('th', null, 'Type'),
          e('th', null, 'Amount'),
          e('th', null, 'Status'),
          e('th', null, 'Submitted'),
        )
      ),
      e('tbody', null,
        submissions.map(sub => {
          const isFocused = focusedSubmissionId === sub.SubmissionID;
          return e('tr', {
            key: sub.SubmissionID,
            title: 'Click to find matching transactions',
            style: {
              cursor: 'pointer',
              background: isFocused ? 'var(--surface2)' : undefined,
              borderLeft: isFocused ? '3px solid var(--yellow)' : '3px solid transparent',
              outline: isFocused ? '1px solid var(--yellow)22' : undefined,
            },
            onClick: () => onFocus(sub.SubmissionID),
          },
            e('td', null,
              e(window.MemberIdChip, { memberId: sub.MemberID, tooltipHandlers, onClick: onViewMember }),
              sub.FirstName
                ? e('span', { style: { color: 'var(--text2)', marginLeft: 4, fontSize: 11 } }, `${sub.FirstName} ${sub.LastName}`)
                : null,
            ),
            e('td', null,
              e('div', null, fmt(sub.SubmissionType)),
              e('div', {
                style: { fontSize: 10, fontFamily: 'monospace', color: 'var(--text2)', marginTop: 2, userSelect: 'all' },
                title: 'SubmissionID — click to copy',
                onClick: ev => { ev.stopPropagation(); navigator.clipboard?.writeText(sub.SubmissionID); },
              }, sub.SubmissionID),
            ),
            e('td', null, fmtMoney(sub.Amount)),
            e('td', null, e(Badge, { status: sub.Status })),
            e('td', { style: { fontSize: 11 } }, fmtDate(sub.Timestamp)),
          );
        })
      )
    );
  };

  const PaymentHistoryTable = ({ payments = [], onCancel }) => {
    const e = React.createElement;
    if (!payments.length) {
      return e('div', { style: { padding: 24, textAlign: 'center', color: 'var(--text2)' } },
        'No payments found'
      );
    }
    return e('table', { className: 'data-table' },
      e('thead', null,
        e('tr', null,
          e('th', null, 'Payment ID'),
          e('th', null, 'Member'),
          e('th', null, 'Amount'),
          e('th', null, 'Payment Type'),
          e('th', null, 'Payment Date'),
          e('th', null, 'Updated'),
          e('th', null, 'Processed By'),
          onCancel ? e('th', null, '') : null,
        )
      ),
      e('tbody', null,
        payments.map((p, i) =>
          e('tr', { key: i, style: { borderBottom: '1px solid var(--border)' } },
            e('td', { style: { fontFamily: 'monospace', fontSize: 11, color: 'var(--text2)' } }, p.PaymentID || '—'),
            e('td', null, `${p.FirstName} ${p.LastName} (${p.MemberID})`),
            e('td', null, fmtMoney(p.Amount)),
            e('td', null, p.PaymentType || '—'),
            e('td', null, fmtDate(p.PaymentDate)),
            e('td', { style: { fontSize: 11, color: 'var(--text2)' } }, fmtDate(p.UpdatedAt)),
            e('td', { style: { fontSize: 11, color: 'var(--text2)' } }, p.ProcessedBy || 'auto'),
            onCancel ? e('td', null,
              e('button', {
                className: 'btn btn-danger',
                style: { fontSize: 11, padding: '2px 8px' },
                onClick: () => {
                  if (confirm(`Cancel payment ${p.PaymentID} for ${p.FirstName} ${p.LastName}?\n\nThis will:\n• Restore member to previous status\n• Revert submission to pending\n• Remove Gmail transaction link\n• Delete the payment record`)) {
                    onCancel(p.PaymentID).catch(err => console.error('Cancel failed:', err));
                  }
                }
              }, 'Cancel')
            ) : null,
          )
        )
      )
    );
  };

  window.StatsCards = StatsCards;
  window.PendingSubmissionsTable = PendingSubmissionsTable;
  window.PaymentHistoryTable = PaymentHistoryTable;
})();
