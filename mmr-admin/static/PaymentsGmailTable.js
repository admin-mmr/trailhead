/**
 * PaymentsGmailTable.js — Right-side Gmail transactions table for the Payments UI.
 *
 * Extracted from PaymentsSubPanels.js (code-health split). Renders gmail_transactions
 * with resizable columns, per-column filtering, and candidate-match mode.
 *
 * Must be loaded BEFORE PaymentsPanel.js in index.html.
 * Depends on: PaymentsHelpers (fmt/fmtDate/fmtMoney/extractMemberIds), MatchCtxBadge,
 *             getMatchContext, and the global `api()` helper.
 *
 * Exported to: window.GmailTable
 */

/* global React, useState, useEffect, useRef, api */

(function() {
  const { fmt, fmtDate, fmtMoney, extractMemberIds } = window.PaymentsHelpers;
  const { MatchCtxBadge, getMatchContext } = window;

  const GmailTable = ({ rows, candidates, focusedSubmission, candidatesLoading, selectedMessageId, onSelect, onQuickApproved, onClearFocus, tooltipHandlers, activePopover, onPopoverToggle, onColFilter }) => {
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
        const target = parseFloat(String(f.amount).replace(/[^0-9.]/g, ''));
        if (!isNaN(target) && Math.abs(amt - target) > 0.001) return false;
      }
      if (f.memo && !(g.Memo || '').toLowerCase().includes(f.memo.toLowerCase())) return false;
      if (f.date && !(g.TransactionDate || '').includes(f.date)) return false;
      if (f.txnum && !(String(g.TransactionNumber || '')).includes(f.txnum)) return false;
      return true;
    }) : baseRows;

    const setFilter = (col, val) => {
      const next = { ...colFilters, [col]: val };
      setColFilters(next);
      if (onColFilter) onColFilter(next);
    };
    const clearAllFilters = () => {
      setColFilters({ sender: '', amount: '', memo: '', date: '', txnum: '' });
      if (onColFilter) onColFilter({ sender: '', amount: '', memo: '', date: '', txnum: '' });
    };
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
              isLinked && isFilterMode
                ? e('button', {
                    className: 'btn btn-sm btn-green',
                    style: { fontSize: 11, padding: '2px 8px' },
                    title: `Link this payment to submission for ${focusedSubmission?.MemberID}`,
                    onClick: ev => {
                      ev.stopPropagation();
                      api('/api/payments/manual-approve', {
                        method: 'POST',
                        body: JSON.stringify({ transactionNumber: g.TransactionNumber, memberID: focusedSubmission.MemberID, submissionId: focusedSubmission.SubmissionID }),
                      }).then(r => {
                        if (r.ok) onQuickApproved(g.MessageId, focusedSubmission.MemberID, 'Payment');
                        else alert(r.error || 'Approve failed');
                      });
                    },
                  }, '✓ Approve')
                : !isLinked && e('button', {
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

  window.GmailTable = GmailTable;
})();
