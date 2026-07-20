// NyrrEventsParts — presentational helpers for the unified NYRR event view.
//
// Extracted from NyrrEvents.js to keep each file under the 300-line
// code-health limit. Exposes a factory that binds the render/format helpers
// to the current `liveData` (the only piece of component state they need):
//
//   const { gapColor, fmt, decodeHtml, fmtDate, SYNC_HEADERS, COV_HEADERS,
//           menuItemStyle, renderSyncCells, renderCovCells, syncStats, covStats }
//     = window.NyrrEventsParts(liveData);
//
// All returned functions are pure w.r.t. props/liveData, matching the previous
// inline behavior exactly. Reuses window.MatchBar when available.
window.NyrrEventsParts = (liveData) => {
  // ---- pure render helpers ------------------------------------------------
  const gapColor = (pct) => pct === null ? 'var(--text2)' : pct >= 99 ? '#22c55e' : pct >= 90 ? '#f59e0b' : '#ef4444';
  const fmt = (n) => (n || n === 0) ? Number(n).toLocaleString() : '—';
  // Event names arrive HTML-escaped from NYRR (e.g. "Hope &amp; Possibility").
  // Decode to text via a detached textarea (reads .value, never injects into the DOM).
  const decodeHtml = (s) => {
    if (s == null) return s;
    if (typeof document === 'undefined') return String(s);
    const t = document.createElement('textarea');
    t.innerHTML = String(s);
    return t.value;
  };
  // Render a 'YYYY-MM-DD' date in LOCAL time. `new Date('YYYY-MM-DD')` parses as
  // UTC midnight, which shows one day early in US timezones (e.g. 6/28 → 6/27).
  const fmtDate = (s) => {
    if (!s) return '—';
    const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})/);
    const d = m ? new Date(+m[1], +m[2] - 1, +m[3]) : new Date(s);
    return d.toLocaleDateString();
  };
  const SYNC_HEADERS = ['MMR Runners', 'All Runners', 'Matched', 'Match %'];
  const COV_HEADERS  = ['NYRR Total', 'DB Total', 'Coverage', 'NYRR MMR', 'DB MMR'];
  const menuItemStyle = { display: 'block', width: '100%', textAlign: 'left', padding: '8px 12px',
    background: 'none', border: 'none', color: 'var(--text)', cursor: 'pointer', fontSize: 13 };

  const renderSyncCells = (ev) => (
    <>
      <td>{ev.mmr_runner_count || 0}</td>
      <td style={{ color: ev.result_count > 0 ? 'var(--text)' : 'var(--text2)' }}>{ev.result_count || 0}</td>
      <td>{ev.mmr_matched_count || 0}</td>
      <td>{window.MatchBar ? <window.MatchBar pct={ev.match_pct || 0} /> : `${ev.match_pct || 0}%`}</td>
    </>
  );
  const renderCovCells = (ev) => {
    const live = liveData[ev.id];
    const nyrr    = live ? live.nyrr_total : ev.nyrr_total;
    const dbTotal = live ? live.db_total   : ev.db_total;
    const dbMmr   = live ? live.db_mmr     : ev.db_mmr;
    const nyrrMmr = live ? live.nyrr_mmr   : ev.nyrr_mmr;
    const pct = (nyrr && nyrr > 0) ? Math.round((dbTotal || 0) / nyrr * 100) : null;
    return (
      <>
        <td style={{ textAlign: 'right', color: 'var(--text2)' }}>
          {nyrr > 0 ? fmt(nyrr) : '—'}{live && <span style={{ fontSize: 10, color: 'var(--accent)', marginLeft: 4 }}>live</span>}
        </td>
        <td style={{ textAlign: 'right' }}>{fmt(dbTotal)}</td>
        <td style={{ textAlign: 'right', fontWeight: 600, color: gapColor(pct) }}>{pct !== null ? `${pct}%` : '—'}</td>
        <td style={{ textAlign: 'right', color: 'var(--text2)' }}>{nyrrMmr !== null && nyrrMmr !== undefined ? fmt(nyrrMmr) : '—'}</td>
        <td style={{ textAlign: 'right' }}>{fmt(dbMmr)}</td>
      </>
    );
  };

  // ---- mobile: compact label/value metrics (same data as the table cells) ----
  const syncStats = (ev) => [
    ['MMR', ev.mmr_runner_count || 0],
    ['All', ev.result_count || 0],
    ['Matched', ev.mmr_matched_count || 0],
    ['Match %', `${ev.match_pct || 0}%`],
  ];
  const covStats = (ev) => {
    const live = liveData[ev.id];
    const nyrr    = live ? live.nyrr_total : ev.nyrr_total;
    const dbTotal = live ? live.db_total   : ev.db_total;
    const dbMmr   = live ? live.db_mmr     : ev.db_mmr;
    const nyrrMmr = live ? live.nyrr_mmr   : ev.nyrr_mmr;
    const pct = (nyrr && nyrr > 0) ? Math.round((dbTotal || 0) / nyrr * 100) : null;
    return [
      ['NYRR', nyrr > 0 ? fmt(nyrr) : '—'],
      ['DB', fmt(dbTotal)],
      ['Cov', pct !== null ? `${pct}%` : '—'],
      ['NYRR MMR', nyrrMmr !== null && nyrrMmr !== undefined ? fmt(nyrrMmr) : '—'],
      ['DB MMR', fmt(dbMmr)],
    ];
  };

  return {
    gapColor, fmt, decodeHtml, fmtDate, SYNC_HEADERS, COV_HEADERS, menuItemStyle,
    renderSyncCells, renderCovCells, syncStats, covStats,
  };
};
