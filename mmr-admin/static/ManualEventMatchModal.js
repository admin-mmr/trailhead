/**
 * ManualEventMatchModal — React component for admin to manually match pending events
 * to gmail_transactions.
 *
 * Features:
 *   - Shows pending events (MatchedMessageId IS NULL)
 *   - Suggests matching gmail transactions in 3 categories:
 *     1. Most likely: amount match + memberID in memo
 *     2. More likely: name/partial name match
 *     3. Recently matched: payment date ±2 days, already matched, amount match
 *   - Admin selects a transaction row
 *   - Fills in MatchedMessageId, MatchedTransactionNumber, AdminApprover, ApprovalDate, PaymentDate, Notes
 *   - Sets Status='approved'
 */

/* global React, api, useState, useEffect, useCallback */

const ManualEventMatchModal = ({ isOpen, onClose, onMatchApproved }) => {
  const [pendingWithMatches, setPendingWithMatches] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [selectedEvent, setSelectedEvent] = useState(null);
  const [selectedTransaction, setSelectedTransaction] = useState(null);
  const [notes, setNotes] = useState('');
  const [approving, setApproving] = useState(false);

  // Fetch pending events with their match suggestions
  useEffect(() => {
    if (!isOpen) return;

    const fetchMatches = async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await api('/api/payments/pending-events-with-matches');
        if (res.ok && res.data) {
          setPendingWithMatches(res.data);
          if (res.data.length > 0) {
            setSelectedEvent(res.data[0]);
          }
        } else {
          setError(res.error || 'Failed to load pending events');
        }
      } catch (err) {
        setError(`Error: ${err.message}`);
      } finally {
        setLoading(false);
      }
    };

    fetchMatches();
  }, [isOpen]);

  const handleSelectEvent = (eventData) => {
    setSelectedEvent(eventData);
    setSelectedTransaction(null);
    setNotes('');
  };

  const handleSelectTransaction = (txn) => {
    setSelectedTransaction(txn);
  };

  const handleApprove = async () => {
    if (!selectedEvent || !selectedTransaction) {
      setError('Please select both an event and a transaction');
      return;
    }

    setApproving(true);
    setError(null);
    try {
      const res = await api('/api/payments/approve-event-match', {
        method: 'POST',
        body: JSON.stringify({
          eventId: selectedEvent.event.EventID,
          messageId: selectedTransaction.MessageId,
          transactionNumber: selectedTransaction.TransactionNumber,
          notes: notes,
        }),
      });

      if (res.ok) {
        // Remove matched event from list
        setPendingWithMatches(prev =>
          prev.filter(x => x.event.EventID !== selectedEvent.event.EventID)
        );
        setSelectedEvent(null);
        setSelectedTransaction(null);
        setNotes('');

        // Callback to parent
        if (onMatchApproved) onMatchApproved(selectedEvent.event.EventID);
      } else {
        setError(res.error || 'Failed to approve match');
      }
    } catch (err) {
      setError(`Error: ${err.message}`);
    } finally {
      setApproving(false);
    }
  };

  if (!isOpen) return null;

  const fmt = (v) => v == null ? '—' : String(v);
  const fmtDate = (v) => {
    if (!v) return '—';
    try {
      return new Date(v).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    } catch {
      return String(v);
    }
  };
  const fmtMoney = (v) => v == null ? '—' : `$${Number(v).toFixed(2)}`;

  return React.createElement('div', {
    style: {
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999,
    }
  },
    React.createElement('div', {
      style: {
        background: 'var(--bg)', borderRadius: 8, boxShadow: '0 8px 32px rgba(0,0,0,0.2)',
        maxWidth: '90vw', maxHeight: '90vh', overflow: 'auto', padding: 24,
      }
    },
      // Header
      React.createElement('div', {
        style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }
      },
        React.createElement('h2', { style: { margin: 0 } }, 'Manual Event Matching'),
        React.createElement('button', {
          onClick: onClose,
          style: {
            background: 'none', border: 'none', fontSize: 24, cursor: 'pointer',
            color: 'var(--text2)', lineHeight: 1,
          }
        }, '×')
      ),

      // Error message
      error && React.createElement('div', {
        style: {
          background: 'var(--red)22', color: 'var(--red)', padding: 12, borderRadius: 4,
          marginBottom: 16, fontSize: 14,
        }
      }, error),

      // Main content: left = events, right = transactions
      React.createElement('div', {
        style: { display: 'grid', gridTemplateColumns: '350px 1fr', gap: 20 }
      },
        // Left: Pending Events
        React.createElement('div', null,
          React.createElement('h3', { style: { margin: '0 0 12px 0', fontSize: 14, fontWeight: 600 } },
            `Pending Events (${pendingWithMatches.length})`
          ),
          loading ? React.createElement('div', { style: { color: 'var(--text2)', fontSize: 14 } }, 'Loading...') :
            React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 400, overflowY: 'auto' } },
              pendingWithMatches.map(eventData =>
                React.createElement('div', {
                  key: eventData.event.EventID,
                  onClick: () => handleSelectEvent(eventData),
                  style: {
                    padding: 12, borderRadius: 4, border: '1px solid var(--border)',
                    background: selectedEvent?.event.EventID === eventData.event.EventID ?
                      'var(--accent)22' : 'transparent',
                    cursor: 'pointer', transition: 'all 200ms',
                  }
                },
                  React.createElement('div', { style: { fontWeight: 600, fontSize: 13 } }, eventData.event.EventID),
                  React.createElement('div', { style: { fontSize: 12, color: 'var(--text2)' } },
                    `${eventData.event.PayerName || eventData.event.Email}`
                  ),
                  React.createElement('div', { style: { fontSize: 12, color: 'var(--text2)', marginTop: 4 } },
                    `${fmtMoney(eventData.event.Amount)} • ${fmtDate(eventData.event.Timestamp)}`
                  )
                )
              )
            )
        ),

        // Right: Match suggestions for selected event
        React.createElement('div', null,
          selectedEvent ? React.createElement(React.Fragment, null,
            React.createElement('h3', { style: { margin: '0 0 12px 0', fontSize: 14, fontWeight: 600 } },
              `Matches for ${selectedEvent.event.EventID}`
            ),

            // Most likely
            selectedEvent.most_likely.length > 0 && React.createElement('div', { style: { marginBottom: 20 } },
              React.createElement('div', {
                style: { fontSize: 12, fontWeight: 600, color: 'var(--green)', marginBottom: 8, textTransform: 'uppercase' }
              }, '⭐ Most Likely'),
              React.createElement(TransactionRows, {
                transactions: selectedEvent.most_likely,
                selected: selectedTransaction,
                onSelect: handleSelectTransaction,
              })
            ),

            // More likely
            selectedEvent.more_likely.length > 0 && React.createElement('div', { style: { marginBottom: 20 } },
              React.createElement('div', {
                style: { fontSize: 12, fontWeight: 600, color: 'var(--text2)', marginBottom: 8, textTransform: 'uppercase' }
              }, '⭐⭐ More Likely'),
              React.createElement(TransactionRows, {
                transactions: selectedEvent.more_likely,
                selected: selectedTransaction,
                onSelect: handleSelectTransaction,
              })
            ),

            // Recently matched
            selectedEvent.recently_matched.length > 0 && React.createElement('div', { style: { marginBottom: 20 } },
              React.createElement('div', {
                style: { fontSize: 12, fontWeight: 600, color: 'var(--text2)', marginBottom: 8, textTransform: 'uppercase' }
              }, '📅 Recently Matched'),
              React.createElement(TransactionRows, {
                transactions: selectedEvent.recently_matched,
                selected: selectedTransaction,
                onSelect: handleSelectTransaction,
              })
            ),

            // Notes field
            selectedTransaction && React.createElement('div', { style: { marginTop: 20 } },
              React.createElement('label', { style: { display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 6 } }, 'Notes (optional):'),
              React.createElement('textarea', {
                value: notes,
                onChange: (e) => setNotes(e.target.value),
                style: {
                  width: '100%', padding: 8, borderRadius: 4, border: '1px solid var(--border)',
                  fontFamily: 'monospace', fontSize: 12, minHeight: 80,
                  background: 'var(--bg2)', color: 'var(--text)',
                }
              })
            )
          ) : React.createElement('div', { style: { color: 'var(--text2)', fontSize: 14 } }, 'Select an event to see matches')
        )
      ),

      // Footer: Approve button
      React.createElement('div', {
        style: { display: 'flex', gap: 12, marginTop: 20, borderTop: '1px solid var(--border)', paddingTop: 16 }
      },
        React.createElement('button', {
          onClick: onClose,
          style: {
            flex: 1, padding: 10, borderRadius: 4, border: '1px solid var(--border)',
            background: 'transparent', color: 'var(--text)', cursor: 'pointer', fontSize: 14, fontWeight: 500,
          }
        }, 'Cancel'),
        React.createElement('button', {
          onClick: handleApprove,
          disabled: !selectedEvent || !selectedTransaction || approving,
          style: {
            flex: 1, padding: 10, borderRadius: 4, border: 'none',
            background: (!selectedEvent || !selectedTransaction) ? 'var(--text2)44' : 'var(--green)',
            color: 'white', cursor: (!selectedEvent || !selectedTransaction) ? 'not-allowed' : 'pointer',
            fontSize: 14, fontWeight: 600, opacity: approving ? 0.6 : 1,
          }
        }, approving ? '⏳ Approving...' : '✓ Approve & Link')
      )
    )
  );
};

// Helper component: Transaction rows table
const TransactionRows = ({ transactions, selected, onSelect }) => {
  const fmt = (v) => v == null ? '—' : String(v);
  const fmtDate = (v) => {
    if (!v) return '—';
    try {
      return new Date(v).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    } catch {
      return String(v);
    }
  };
  const fmtMoney = (v) => v == null ? '—' : `$${Number(v).toFixed(2)}`;

  return React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: 8 } },
    transactions.map(txn =>
      React.createElement('div', {
        key: txn.MessageId,
        onClick: () => onSelect(txn),
        style: {
          padding: 10, borderRadius: 4, border: '1px solid var(--border)',
          background: selected?.MessageId === txn.MessageId ? 'var(--accent)22' : 'transparent',
          cursor: 'pointer', transition: 'all 200ms', fontSize: 12,
        }
      },
        React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', fontWeight: 500 } },
          React.createElement('span', null, fmtMoney(txn.Amount)),
          React.createElement('span', { style: { color: 'var(--text2)' } }, fmtDate(txn.TimeStamp))
        ),
        React.createElement('div', { style: { color: 'var(--text2)', marginTop: 4, wordBreak: 'break-word' } },
          `${txn.Sender || '—'}`
        ),
        txn.Memo && React.createElement('div', {
          style: { color: 'var(--text2)', marginTop: 4, fontSize: 11, fontStyle: 'italic' }
        }, `"${String(txn.Memo).substring(0, 60)}..."`),
      )
    )
  );
};

// Export for use in PaymentsPanel
window.ManualEventMatchModal = ManualEventMatchModal;
