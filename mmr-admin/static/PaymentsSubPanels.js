/**
 * PaymentsSubPanels.js — Data tables for Payments UI.
 *
 * Components:
 *   - StatsCards: Dashboard stats grid with autoguess button
 *   - PendingSubmissionsTable: Left-side submissions list (toggleable)
 *   - GmailTable: Right-side Gmail transactions with resizable columns, filtering, candidates mode
 *   - PaymentHistoryTable: Approved payments list
 *
 * Must be loaded BEFORE PaymentsPanel.js in index.html.
 * Depends on: PaymentsHelpers, MemberTooltip, GmailQuickApprove (for helpers, components, utilities)
 *
 * Exported to: window.StatsCards, window.PendingSubmissionsTable, window.GmailTable, window.PaymentHistoryTable
 */

/* global React, useState, useEffect, useRef */

(function() {
  const { fmt, fmtDate, fmtMoney, Badge, extractMemberIds, PAYMENT_INTENTS } = window.PaymentsHelpers;
  const { MemberIdChip } = window;
  const { MatchCtxBadge, getMatchContext } = window;

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
          e('th', null, 'Type'),
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

  const GmailTable = ({ rows, candidates, focusedSubmission, candidatesLoading, selectedMessageId, onSelect, onQuickApproved, onClearFocus, tooltipHandlers, activePopover, onPopoverToggle }) => {
    const [colWidths, setColWidths] = useState({ sender: 120, memo: 200 });
    const [resizing, setResizing] = useState(null);
    const [colFilters, setColFilters] = useState({ sender: '', amount: '', memo: '', date: '', txnum: '' });
    const tableRef = useRef(null);
    const e = React.createElement;

    const activeGmailData = activePopover ? rows.find(g => g.MessageId === activePopover) : null;

    const isFilterMode = candidates !== null;
    const baseRows = isFilterMode ? candidates : rows;

    const hasColFilter = !isFilterMode && Object.values(colFilters).some(v => v.trim());
    const displayRows = hasColFilter ? baseRows.filter(g => {
      const f = colFilters;
      if (f.sender && !(g.Sender || '').toLowerCase().includes(f.sender.toLowerCase())) return false;
      if (f.amount) {
        const amt = parseFloat(String(g.Amount || '').replace(/[^0-9.]/g, ''));
        const target = parseFloat(f.amount);
        if (!isNaN(target) && Math.abs(amt - target) > 0.001) return false;
      }
      if (f.memo && !(g.Memo || '').toLowerCase().includes(f.memo.toLowerCase())) return false;
      if (f.date && !(g.TransactionDate || '').includes(f.date)) return false;
      if (f.txnum && !(String(g.TransactionNumber || '')).includes(f.txnum)) return false;
      return true;
    }) : baseRows;

    const setFilter = (col, val) => setColFilters(prev => ({ ...prev, [col]: val }));
    const clearAllFilters = () => setColFilters({ sender: '', amount: '', memo: '', date: '', txnum: '' });
    const filterInput = (col, placeholder) => e('div', { style: { position: 'relative', marginTop: 3 } },
      e('input', {
        type: 'text', value: colFilters[col], placeholder,
        onChange: ev => { ev.stopPropagation(); setFilter(col, ev.target.value); },
        onClick: ev => ev.stopPropagation(),
        style: {
          width: '100%', fontSize: 11, padding: colFilters[col] ? '2px 18px 2px 4px' : '2px 4px',
          boxSizing: 'border-box',
          border: colFilters[col] ? '1px solid var(--accent)' : '1px solid var(--border)',
          borderRadius: 3, background: 'var(--surface2)', color: 'var(--text)', outline: 'none',
        },
      }),
      colFilters[col] && e('span', {
        onClick: ev => { ev.stopPropagation(); setFilter(col, ''); },
        style: {
          position: 'absolute', right: 3, top: '50%', transform: 'translateY(-50%)',
          cursor: 'pointer', fontSize: 10, color: 'var(--text2)', lineHeight: 1,
          padding: '0 2px',
        },
        title: 'Clear filter',
      }, '✕'),
    );

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

    return e('table', { className: 'data-table', ref: tableRef, style: { tableLayout: 'fixed' } },
      e('thead', null,
        e('tr', null,
          e('th', { style: { width: 28, padding: '0 4px' } }, ''),
          isFilterMode && e('th', null, 'Match'),
          e('th', {
            style: { position: 'relative', width: colWidths.sender, userSelect: 'none' },
            title: 'Drag right edge to resize'
          },
            e('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' } },
              'Sender',
              e('div', {
                onMouseDown: (ev) => handleResizeStart('sender', ev),
                style: { cursor: 'col-resize', width: 4, height: 20, margin: '0 -2px',
                  background: resizing?.col === 'sender' ? 'var(--accent)' : 'transparent', transition: 'background 0.2s' }
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
                style: { cursor: 'col-resize', width: 4, height: 20, margin: '0 -2px',
                  background: resizing?.col === 'memo' ? 'var(--accent)' : 'transparent', transition: 'background 0.2s' }
              })
            )
          ),
          e('th', null, 'Tx Date'),
          e('th', null, 'Tx #'),
          e('th', null, ''),
        ),
        !isFilterMode && e('tr', null,
          e('th', { style: { width: 28, padding: '0 4px' } }),
          e('th', { style: { padding: '0 4px 4px' } }, filterInput('sender', 'Filter…')),
          e('th', { style: { padding: '0 4px 4px' } }, filterInput('amount', 'e.g. 30')),
          e('th', { style: { padding: '0 4px 4px' } }, filterInput('memo', 'Filter…')),
          e('th', { style: { padding: '0 4px 4px' } }, filterInput('date', 'YYYY-MM-DD')),
          e('th', { style: { padding: '0 4px 4px' } }, filterInput('txnum', 'Filter…')),
          e('th', null),
        ),
      ),
      e('tbody', null,
        displayRows.map(g => {
          const memoIds = extractMemberIds((g.Memo || '') + ' ' + (g.OriginalMemo || ''));
          const hasMemoId = memoIds.length > 0;
          const isOpen    = activePopover === g.MessageId;
          const ctx       = getMatchContext(g);
          const isLinked  = ctx.status === 'matched';

          return e('tr', {
            key: g.MessageId,
            style: {
              cursor: 'pointer',
              background: selectedMessageId === g.MessageId
                ? 'var(--surface2)'
                : isLinked ? 'rgba(0,200,100,0.06)' : undefined,
              opacity: (isFilterMode && ctx.time && !isLinked) ? 0.72 : 1,
            },
            onClick: () => onSelect(g.MessageId === selectedMessageId ? null : g.MessageId),
          },
            e('td', { style: { width: 28, padding: '0 4px', textAlign: 'center' } },
              e('input', { type: 'radio', checked: selectedMessageId === g.MessageId, onChange: () => onSelect(g.MessageId), onClick: ev => ev.stopPropagation() })
            ),
            isFilterMode && e('td', { style: { whiteSpace: 'nowrap' } },
              e(MatchCtxBadge, { status: ctx.status, linkedTime: ctx.time })
            ),
            e('td', { style: { fontSize: 12, width: colWidths.sender, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, fmt(g.Sender)),
            e('td', null, fmtMoney(g.Amount)),
            e('td', { style: { width: colWidths.memo, whiteSpace: 'normal', wordBreak: 'break-word', position: 'relative', minWidth: 0 } },
              hasMemoId
                ? e('div', { style: { display: 'flex', gap: 4, alignItems: 'flex-start', flexWrap: 'wrap', minWidth: 0 } },
                    e('span', {
                      style: {
                        display: 'inline-block', background: 'var(--accent)22', color: 'var(--accent)',
                        border: '1px solid var(--accent)44', borderRadius: 3, padding: '1px 5px',
                        fontSize: 11, fontWeight: 600, cursor: 'default', flexShrink: 0,
                      },
                      title: `MemberID: ${memoIds.join(', ')}`,
                    }, memoIds[0]),
                    e('span', { style: { color: 'var(--accent)', fontWeight: 500, cursor: 'pointer', flexShrink: 0 },
                      onMouseEnter: () => {
                        const el = event?.currentTarget;
                        if (el && tooltipHandlers?.onHover) {
                          tooltipHandlers.onHover(memoIds[0], el.getBoundingClientRect());
                        }
                      },
                      onMouseLeave: tooltipHandlers?.onLeave,
                    }, memoIds[0]),
                    e('span', { style: { color: 'var(--text2)', wordBreak: 'break-word' } }, fmt(g.Memo)),
                  )
                : e('span', { style: { color: 'var(--text2)' } }, fmt(g.Memo)),
            ),
            e('td', { style: { fontSize: 11 } }, fmtDate(g.TransactionDate)),
            e('td', { style: { fontSize: 11, fontFamily: 'monospace' } }, fmt(g.TransactionNumber)),
            e('td', { style: { position: 'relative', whiteSpace: 'nowrap' }, onClick: ev => ev.stopPropagation() },
              !isLinked && e('button', {
                className: `btn btn-sm ${hasMemoId ? 'btn-green' : 'btn-outline'}`,
                style: { fontSize: 11, padding: '2px 8px' },
                title: hasMemoId ? `Quick-approve for ${memoIds.join(', ')}` : 'Create payment',
                onClick: ev => { ev.stopPropagation(); onPopoverToggle(isOpen ? null : g.MessageId, ev.currentTarget.getBoundingClientRect()); },
              }, hasMemoId ? '⚡ Quick' : '+ Create'),
            ),
          );
        }),
        displayRows.length === 0 && e('tr', null,
          e('td', {
            colSpan: 7,
            style: { textAlign: 'center', padding: '24px 0', color: 'var(--text2)' },
          },
            hasColFilter
              ? e('span', null,
                  'No results for current filters — ',
                  e('span', {
                    style: { color: 'var(--accent)', cursor: 'pointer', textDecoration: 'underline' },
                    onClick: clearAllFilters,
                  }, 'clear all filters'),
                )
              : (isFilterMode ? 'No candidates found for this submission' : 'No unmatched Gmail transactions'),
          ),
        ),
      )
    );
  };

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
          e('th', null, 'Payment Type'),
          e('th', null, 'Payment Date'),
          e('th', null, 'Updated'),
          e('th', null, 'Processed By'),
        )
      ),
      e('tbody', null,
        payments.map((p, i) =>
          e('tr', { key: i, style: { borderBottom: '1px solid var(--border)' } },
            e('td', null, `${p.FirstName} ${p.LastName} (${p.MemberID})`),
            e('td', null, fmtMoney(p.Amount)),
            e('td', null, p.PaymentType || '—'),
            e('td', null, fmtDate(p.PaymentDate)),
            e('td', { style: { fontSize: 11, color: 'var(--text2)' } }, fmtDate(p.UpdatedAt)),
            e('td', { style: { fontSize: 11, color: 'var(--text2)' } }, p.ProcessedBy || 'auto'),
          )
        )
      )
    );
  };

  window.StatsCards = StatsCards;
  window.PendingSubmissionsTable = PendingSubmissionsTable;
  window.GmailTable = GmailTable;
  window.PaymentHistoryTable = PaymentHistoryTable;
})();
