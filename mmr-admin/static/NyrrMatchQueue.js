/**
 * NyrrMatchQueue.js — NYRR unmatched finisher review queue.
 *
 * Fetches paginated unmatched finishers from GET /api/nyrr/match-queue.
 * Each row shows top-3 candidate chips for quick-confirm, plus an "open" button
 * that spawns the existing MatchModal for a full search.
 *
 * Tier-4 auto_fuzzy pre-suggestions are flagged yellow so admins know they need
 * re-confirmation before the match is committed.
 *
 * Actions:
 *   • Click a candidate chip → confirm that match immediately
 *   • "Open" button → MatchModal for manual search
 *   • "Bulk confirm single-candidate hits" → POST /api/nyrr/match-queue/bulk-confirm
 *
 * Depends on: api() global, React globals, window.MatchModal, window.RunnerRow
 * Exported: window.NyrrMatchQueue
 *
 * Row-level pieces (RunnerRow / CandidateChip / helpers) live in
 * NyrrMatchQueueParts.js, loaded BEFORE this file.
 */

/* global React, useState, useEffect, useCallback, useRef, api */

(function () {
  const e = React.createElement;

  // ── Main panel ───────────────────────────────────────────────────────────

  const NyrrMatchQueue = () => {
    const [data, setData]           = useState(null);
    const [loading, setLoading]     = useState(true);
    const [error, setError]         = useState(null);
    const [page, setPage]           = useState(1);
    const [mmrOnly, setMmrOnly]     = useState(true);
    const [confirmingId, setConfirmingId] = useState(null);
    const [bulkLoading, setBulkLoading]   = useState(false);
    const [toast, setToast]         = useState('');
    const [modalRunner, setModalRunner]   = useState(null);

    const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(''), 4000); };

    const load = useCallback((p = page) => {
      setLoading(true);
      setError(null);
      const qs = new URLSearchParams({ page: p, mmr_only: mmrOnly ? '1' : '0' });
      api(`/api/nyrr/match-queue?${qs}`).then(r => {
        setLoading(false);
        if (r && r.ok) setData(r.data);
        else setError(r?.error || 'Failed to load queue');
      }).catch(err => { setLoading(false); setError(err.message); });
    }, [page, mmrOnly]);

    useEffect(() => { setPage(1); }, [mmrOnly]);
    useEffect(() => { load(page); }, [page, mmrOnly]);

    const handleMatched = useCallback((runnerId) => {
      setConfirmingId(null);
      showToast('✓ Matched');
      // Remove from local list immediately
      setData(prev => prev ? {
        ...prev,
        total: prev.total - 1,
        runners: prev.runners.filter(r => r.id !== runnerId),
      } : prev);
    }, []);

    const handleBulkConfirm = useCallback(() => {
      setBulkLoading(true);
      api('/api/nyrr/match-queue/bulk-confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mmr_only: mmrOnly }),
      }).then(r => {
        setBulkLoading(false);
        if (r && r.ok) {
          showToast(`✓ Bulk matched ${r.matched} of ${r.scanned} scanned`);
          load(1); setPage(1);
        } else {
          showToast(`✗ ${r?.error || 'Bulk confirm failed'}`);
        }
      }).catch(err => { setBulkLoading(false); showToast(`✗ ${err.message}`); });
    }, [mmrOnly, load]);

    const singleCandidateCount = data
      ? data.runners.filter(r => r.candidates && r.candidates.length === 1).length
      : 0;

    return e('div', { style: { padding: '4px 0' } },
      // Toast
      toast && e('div', {
        style: {
          position: 'fixed', top: 16, right: 16, zIndex: 200,
          background: 'var(--surface)', border: '1px solid var(--accent)',
          borderRadius: 'var(--radius)', padding: '10px 16px',
          fontSize: 13, boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
        }
      }, toast),

      // MatchModal (spawned per-row)
      modalRunner && window.MatchModal && e(window.MatchModal, {
        runner: modalRunner,
        onClose: () => setModalRunner(null),
        onMatched: (runnerId) => { setModalRunner(null); handleMatched(runnerId); },
      }),

      // Header + controls
      e('div', {
        style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, flexWrap: 'wrap', gap: 10 }
      },
        e('div', null,
          e('h3', { style: { margin: 0, fontSize: 15, fontWeight: 700 } }, '🏃 Match Queue'),
          data && e('span', { style: { fontSize: 12, color: 'var(--text2)' } },
            `${data.total.toLocaleString()} unmatched finishers`),
        ),
        e('div', { style: { display: 'flex', alignItems: 'center', gap: 10 } },
          e('label', { style: { display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, cursor: 'pointer' } },
            e('input', {
              type: 'checkbox', checked: mmrOnly,
              onChange: ev => setMmrOnly(ev.target.checked),
            }),
            'MMR team only',
          ),
          singleCandidateCount > 0 && e('button', {
            className: 'btn btn-sm',
            onClick: handleBulkConfirm,
            disabled: bulkLoading,
            title: `Auto-confirm ${singleCandidateCount} rows on this page that have exactly one candidate`,
            style: {
              fontSize: 12, fontWeight: 600,
              background: 'var(--accent)', color: '#fff',
              border: 'none', borderRadius: 'var(--radius)', padding: '5px 14px',
            },
          }, bulkLoading ? '⏳ Confirming…' : `⚡ Bulk confirm (${singleCandidateCount} on page)`),
          e('button', {
            className: 'btn btn-sm btn-outline',
            onClick: () => load(page),
            disabled: loading,
            style: { fontSize: 12 },
          }, loading ? 'Loading…' : '↺ Refresh'),
        ),
      ),

      // Error
      error && e('div', {
        style: { padding: 16, background: 'rgba(248,113,113,0.1)', border: '1px solid var(--red)', borderRadius: 'var(--radius)', marginBottom: 16, color: 'var(--red)', fontSize: 13 }
      }, `Error: ${error}`),

      // Table
      !error && e('div', { style: { border: '1px solid var(--border)', borderRadius: 'var(--radius)', overflowX: 'auto' } },
        e('table', { className: 'data-table', style: { width: '100%', tableLayout: 'auto' } },
          e('thead', null,
            e('tr', null,
              e('th', { style: { padding: '7px 10px', fontSize: 12 } }, 'Runner'),
              e('th', { style: { padding: '7px 10px', fontSize: 12 } }, 'Event'),
              e('th', { style: { padding: '7px 10px', fontSize: 12 } }, 'Candidates'),
              e('th', { style: { padding: '7px 10px', fontSize: 12 } }, ''),
            ),
          ),
          e('tbody', null,
            loading
              ? e('tr', null, e('td', { colSpan: 4, style: { padding: 24, textAlign: 'center', color: 'var(--text2)' } }, 'Loading…'))
              : (!data || data.runners.length === 0)
                ? e('tr', null, e('td', { colSpan: 4, style: { padding: 24, textAlign: 'center', color: 'var(--text2)' } }, '✓ No unmatched finishers'))
                : data.runners.map(runner =>
                    e(window.RunnerRow, {
                      key: runner.id,
                      runner,
                      onMatched: handleMatched,
                      confirmingId,
                      onConfirmStart: setConfirmingId,
                      onOpenModal: setModalRunner,
                    })
                  ),
          ),
        ),
      ),

      // Pagination
      data && data.pages > 1 && e('div', {
        style: { marginTop: 12, display: 'flex', justifyContent: 'center', gap: 8, alignItems: 'center', fontSize: 13 }
      },
        e('button', {
          className: 'btn btn-sm btn-outline',
          onClick: () => setPage(p => Math.max(1, p - 1)),
          disabled: page <= 1 || loading,
        }, '← Prev'),
        e('span', { style: { color: 'var(--text2)' } }, `Page ${page} of ${data.pages}`),
        e('button', {
          className: 'btn btn-sm btn-outline',
          onClick: () => setPage(p => Math.min(data.pages, p + 1)),
          disabled: page >= data.pages || loading,
        }, 'Next →'),
      ),
    );
  };

  window.NyrrMatchQueue = NyrrMatchQueue;
})();
