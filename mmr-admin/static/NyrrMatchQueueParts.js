/**
 * NyrrMatchQueueParts.js — presentational pieces for the NYRR match queue.
 *
 * Extracted from NyrrMatchQueue.js to keep each file under the 300-line
 * code-health limit. Defines the row-level helpers and components:
 *   • fmtDate / genderSymbol / confidenceLabel (pure helpers)
 *   • CandidateChip (quick-confirm chip)
 *   • RunnerRow (one queue row) — exported as window.RunnerRow
 *
 * Depends on: api() global, React globals.
 * Loaded BEFORE NyrrMatchQueue.js.
 */

/* global React, api */

(function () {
  const e = React.createElement;

  // ── helpers ─────────────────────────────────────────────────────────────────

  const fmtDate = (iso) => {
    if (!iso) return '';
    return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };

  const genderSymbol = (g) => {
    if (!g) return '';
    const u = g.toUpperCase()[0];
    return u === 'M' ? '♂' : u === 'W' || u === 'F' ? '♀' : g;
  };

  const confidenceLabel = (cand, runner) => {
    const rFull = `${runner.first_name || ''} ${runner.last_name || ''}`.trim().toLowerCase();
    const mFull = `${cand.first_name || ''} ${cand.last_name || ''}`.trim().toLowerCase();
    const nyrr  = (cand.nyrr_runner_name || '').trim().toLowerCase();
    if (rFull === mFull || (nyrr && rFull === nyrr)) return { label: 'Exact', cls: 'green' };
    const rFirst = (runner.first_name || '').trim().toLowerCase();
    const rLast  = (runner.last_name  || '').trim().toLowerCase();
    if (rFirst === (cand.first_name || '').trim().toLowerCase() &&
        rLast  === (cand.last_name  || '').trim().toLowerCase()) return { label: 'Exact', cls: 'green' };
    return { label: 'Partial', cls: 'yellow' };
  };

  // ── CandidateChip ─────────────────────────────────────────────────────────

  const CandidateChip = ({ cand, runner, onConfirm, confirming }) => {
    const conf = confidenceLabel(cand, runner);
    return e('button', {
      onClick: () => onConfirm(cand.member_id),
      disabled: !!confirming,
      title: `Confirm: ${cand.first_name} ${cand.last_name} (${cand.member_id}) — ${cand.status}`,
      style: {
        display: 'inline-flex', alignItems: 'center', gap: 5,
        padding: '3px 9px', borderRadius: 99, fontSize: 11, cursor: 'pointer',
        background: 'var(--surface2)', border: '1px solid var(--border)',
        color: 'var(--text)', fontWeight: 500,
        opacity: confirming ? 0.5 : 1,
      },
    },
      e('span', {
        style: {
          width: 6, height: 6, borderRadius: '50%', flexShrink: 0,
          background: conf.cls === 'green' ? 'var(--green)' : 'var(--yellow)',
        }
      }),
      `${cand.first_name} ${cand.last_name}`,
      e('span', { style: { color: 'var(--text2)', fontSize: 10 } },
        cand.member_id),
      cand.status !== 'active' && e('span', {
        style: { fontSize: 10, color: 'var(--text2)' }
      }, `(${cand.status})`),
    );
  };

  // ── RunnerRow ────────────────────────────────────────────────────────────

  const RunnerRow = ({ runner, onMatched, confirmingId, onConfirmStart, onOpenModal }) => {
    const isFuzzy = runner.match_method === 'auto_fuzzy';
    const rowBg   = isFuzzy ? 'rgba(251,191,36,0.06)' : 'transparent';

    const handleConfirm = (memberId) => {
      onConfirmStart(runner.id);
      api(`/api/runners/${runner.id}/match`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ member_id: memberId }),
      }).then(r => {
        if (r && r.ok) onMatched(runner.id);
        else onConfirmStart(null);
      }).catch(() => onConfirmStart(null));
    };

    return e('tr', { style: { background: rowBg } },
      e('td', { style: { padding: '7px 10px', fontSize: 12, whiteSpace: 'nowrap' } },
        e('div', { style: { fontWeight: 600 } }, runner.runner_name),
        e('div', { style: { color: 'var(--text2)', fontSize: 11 } },
          [runner.age ? `Age ${runner.age}` : null, genderSymbol(runner.gender), runner.team_code]
            .filter(Boolean).join(' · ')
        ),
        isFuzzy && e('span', {
          style: {
            fontSize: 10, padding: '1px 6px', borderRadius: 99,
            background: 'rgba(251,191,36,0.2)', color: '#ca8a04', marginTop: 3, display: 'inline-block',
          }
        }, `🔶 fuzzy ${runner.confidence_score}%`),
      ),
      e('td', { style: { padding: '7px 10px', fontSize: 11, color: 'var(--text2)' } },
        e('div', null, runner.event_name),
        e('div', null, fmtDate(runner.event_date)),
        e('div', { style: { color: 'var(--accent)', marginTop: 2 } }, `#${runner.bib_number}`),
      ),
      e('td', { style: { padding: '7px 10px' } },
        runner.candidates && runner.candidates.length > 0
          ? e('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 5 } },
              ...runner.candidates.map(cand =>
                e(CandidateChip, {
                  key: cand.member_id,
                  cand, runner,
                  onConfirm: handleConfirm,
                  confirming: confirmingId === runner.id,
                })
              ),
            )
          : e('span', { style: { color: 'var(--text2)', fontSize: 11 } }, '—'),
      ),
      e('td', { style: { padding: '7px 10px' } },
        e('button', {
          className: 'btn btn-sm btn-outline',
          onClick: () => onOpenModal(runner),
          style: { fontSize: 11, padding: '2px 8px' },
        }, 'Search'),
      ),
    );
  };

  window.RunnerRow = RunnerRow;
})();
