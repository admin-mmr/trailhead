// NyrrEvents — unified NYRR event view (merges former Todos + Reconcile).
//
// One event table, two "lenses" over the same rows:
//   • Sync     — MMR runners, all runners, matched, match %   (was Todos)
//   • Coverage — NYRR total, DB total, coverage %, MMR counts (was Reconcile)
//
// Responsive: wide screens show BOTH lenses side-by-side; narrow screens show
// one lens with a toggle (persisted in localStorage).
//
// This file is the VIEW only. All state, data loading and side-effecting
// actions live in window.useNyrrEventsController (NyrrEventsActions.js), kept
// separate so each file stays under the 300-line code-health limit.
// Reuses window.NyrrActiveLoads / window.NyrrProbeProgress for progress.
initComponent('NyrrEvents', ({ onSelectEvent, onGoSettings }) => {
  const { useState, useEffect } = React;

  const WIDE_BREAKPOINT = 1100;

  const {
    events, stats, loading, dbError, toast, setToast, filter, years,
    probing, liveData, bulkProgress, menuOpen, setMenuOpen, activeLoads,
    load, triggerLoad, cancelLoad, tagMmrOne, clearAndReload,
    probe, probeAll, discoverEvents, discoverUpcoming, tagMmrBatch, isPast,
  } = window.useNyrrEventsController();

  // ---- responsive width + lens (pure UI state) ----------------------------
  const [width, setWidth] = useState(typeof window !== 'undefined' ? window.innerWidth : 1400);
  useEffect(() => {
    const onResize = () => setWidth(window.innerWidth);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  const isWide = width >= WIDE_BREAKPOINT;

  const [lens, setLens] = useState(() => {
    try { return localStorage.getItem('nyrrEventsLens') || 'sync'; } catch (e) { return 'sync'; }
  });
  const setLensPersist = (l) => {
    setLens(l);
    try { localStorage.setItem('nyrrEventsLens', l); } catch (e) {}
  };
  const activeLenses = isWide ? ['sync', 'coverage'] : [lens];

  // ---- pure render helpers ------------------------------------------------
  const gapColor = (pct) => pct === null ? 'var(--text2)' : pct >= 99 ? '#22c55e' : pct >= 90 ? '#f59e0b' : '#ef4444';
  const fmt = (n) => (n || n === 0) ? Number(n).toLocaleString() : '—';
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

  const renderActions = (ev) => {
    const ld = activeLoads[ev.id];
    const inFlight = ld && !['done', 'error', 'cancelled'].includes(ld.status);
    const busy = !!inFlight || !!probing[ev.id];
    const isCompleted = ev.processing_status === 'Completed';
    return (
      <div style={{ display: 'flex', gap: 4, alignItems: 'center', position: 'relative' }}>
        <button
          className="btn btn-sm btn-green"
          disabled={busy}
          title={isCompleted ? 'Re-fetch finishers (incremental, non-destructive)' : 'Fetch finishers from NYRR (3-step sync). Runs in background.'}
          onClick={() => triggerLoad(ev)}
        >
          {inFlight ? <><span className="spinner" /> Loading…</> : (isCompleted ? '🔄 Reload' : '▶ Load')}
        </button>
        <button
          className="btn btn-sm btn-outline"
          disabled={busy}
          title="More actions"
          onClick={() => setMenuOpen(menuOpen === ev.id ? null : ev.id)}
        >⋯</button>
        {menuOpen === ev.id && (
          <div style={{ position: 'absolute', top: '100%', right: 0, zIndex: 50, marginTop: 4,
            background: 'var(--panel, #1a1a1a)', border: '1px solid var(--border)', borderRadius: 6,
            minWidth: 160, boxShadow: '0 4px 12px rgba(0,0,0,0.3)' }}>
            <button className="menu-item" style={menuItemStyle} onClick={() => triggerLoad(ev, false, true)}>👟 MMR only (fast)</button>
            <button className="menu-item" style={menuItemStyle} onClick={() => probe(ev)}>🔍 Probe coverage</button>
            <button className="menu-item" style={menuItemStyle} onClick={() => tagMmrOne(ev)}>🏷 Re-tag MMR</button>
            <button className="menu-item" style={{ ...menuItemStyle, color: '#ef4444' }} onClick={() => clearAndReload(ev)}>🗑 Clear &amp; reload</button>
          </div>
        )}
      </div>
    );
  };

  const renderTable = (rows, title, withCoverage) => {
    if (!rows.length) return null;
    const lenses = withCoverage ? activeLenses : ['sync'];
    return (
      <>
        <h3 style={{ marginTop: 20, marginBottom: 8, fontSize: 16, fontWeight: 600 }}>{title} ({rows.length})</h3>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Event</th>
                <th>Code</th>
                <th>Date</th>
                <th>Status</th>
                {lenses.includes('sync') && SYNC_HEADERS.map(h => <th key={'s' + h}>{h}</th>)}
                {lenses.includes('coverage') && COV_HEADERS.map(h => <th key={'c' + h} style={{ textAlign: 'right' }}>{h}</th>)}
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(ev => (
                <tr key={ev.id}>
                  <td>
                    <a href="#" onClick={e => { e.preventDefault(); onSelectEvent(ev.id, ev.event_code); }} style={{ fontWeight: 600 }}>{ev.event_name}</a>
                    {ev.event_url && (
                      <div style={{ fontSize: 11 }}>
                        <a href={ev.event_url} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent)', textDecoration: 'none' }} title="View on NYRR">↗ NYRR</a>
                      </div>
                    )}
                  </td>
                  <td style={{ fontFamily: 'monospace', fontSize: 12 }}>{ev.event_code || '—'}</td>
                  <td>{ev.event_date ? new Date(ev.event_date).toLocaleDateString() : '—'}</td>
                  <td>{window.StatusBadge ? <window.StatusBadge status={ev.processing_status} /> : ev.processing_status}</td>
                  {lenses.includes('sync') && renderSyncCells(ev)}
                  {lenses.includes('coverage') && renderCovCells(ev)}
                  <td>{renderActions(ev)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </>
    );
  };

  // ---- early state: no DB -------------------------------------------------
  if (dbError) {
    return (
      <div className="empty" style={{ paddingTop: 80 }}>
        <div className="big" style={{ fontSize: 48 }}>⚡</div>
        <h2 style={{ marginBottom: 8 }}>Not Connected to Database</h2>
        <p style={{ color: 'var(--text2)', maxWidth: 400, margin: '0 auto 20px' }}>Connect to your Azure MySQL database to browse NYRR events.</p>
        <button className="btn btn-primary" style={{ fontSize: 15, padding: '10px 24px' }} onClick={onGoSettings}>Open Settings</button>
      </div>
    );
  }

  const upcoming = events.filter(ev => !isPast(ev));
  const past = events.filter(isPast);

  return (
    <div onClick={() => menuOpen && setMenuOpen(null)}>
      {/* Stat cards */}
      {stats && (
        <div className="stat-grid" style={{ marginBottom: 16 }}>
          <div className="stat-card"><div className="label">Total Events</div><div className="value">{stats.total_events}</div></div>
          <div className="stat-card"><div className="label">MMR Runners</div><div className="value">{stats.total_mmr_runners}</div></div>
          <div className="stat-card"><div className="label">Upcoming</div><div className="value accent">{stats.upcoming_events}</div></div>
        </div>
      )}

      {/* Toolbar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        <button className="btn btn-outline btn-sm" onClick={load} disabled={loading || !!bulkProgress}>↺ Refresh</button>
        <button className="btn btn-primary btn-sm" onClick={discoverEvents}>Discover New Events</button>
        <button className="btn btn-outline btn-sm" onClick={discoverUpcoming}>Discover Upcoming</button>
        <button className="btn btn-outline btn-sm" onClick={probeAll} disabled={loading || !!bulkProgress} title="Coverage check only: probes NYRR live for every past event; auto-marks Completed ≥99%, demotes <99%.">
          {bulkProgress ? '⏳ Probing…' : '🔍 Probe All'}
        </button>
        <button className="btn btn-outline btn-sm" onClick={tagMmrBatch} title="Re-tag MMR across all past events with 0 MMR (recovery for cleared team_code)">🏷 Reconcile MMR Tags</button>

        {/* Lens toggle — only meaningful on narrow screens */}
        {!isWide && (
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 4, alignItems: 'center' }}>
            <span style={{ fontSize: 12, color: 'var(--text2)' }}>View:</span>
            <button className={`btn btn-sm ${lens === 'sync' ? 'btn-primary' : 'btn-outline'}`} onClick={() => setLensPersist('sync')}>Sync</button>
            <button className={`btn btn-sm ${lens === 'coverage' ? 'btn-primary' : 'btn-outline'}`} onClick={() => setLensPersist('coverage')}>Coverage</button>
          </div>
        )}
        <span style={{ fontSize: 12, color: 'var(--text2)', marginLeft: isWide ? 'auto' : 0 }}>
          {past.length} past · {isWide ? 'Sync + Coverage' : (lens === 'sync' ? 'Sync lens' : 'Coverage lens')} · Probe hits NYRR live
        </span>
      </div>

      {/* In-flight loads + probe progress (reused components) */}
      {window.NyrrActiveLoads && <window.NyrrActiveLoads loads={activeLoads} onCancel={cancelLoad} />}
      {bulkProgress && window.NyrrProbeProgress && (
        <window.NyrrProbeProgress current={bulkProgress.current} total={bulkProgress.total} code={bulkProgress.code} />
      )}

      <div className="panel">
        {loading ? (
          <div style={{ textAlign: 'center', padding: 40 }}><span className="spinner" /> Loading events...</div>
        ) : events.length === 0 ? (
          <div className="empty" style={{ padding: 40 }}><div className="big">-</div>No events found</div>
        ) : (
          <>
            {renderTable(upcoming, '📅 Upcoming Events', false)}
            {renderTable(past, '📦 Past Events', true)}
          </>
        )}
      </div>

      {toast && <Toast message={toast} onClose={() => setToast('')} />}
    </div>
  );
});
