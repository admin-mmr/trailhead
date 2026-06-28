// NyrrEventsActions — controller hook for the NyrrEvents view.
//
// Owns ALL state and side-effecting actions (data load, concurrent finisher
// loads + polling, probes, discovery, MMR re-tag). NyrrEvents.js consumes the
// returned object and is purely presentational. Split out so each file stays
// under the 300-line code-health limit (CLAUDE.md hard rule).
//
// Usage (inside a component render):
//   const c = window.useNyrrEventsController();
window.useNyrrEventsController = function useNyrrEventsController() {
  const { useState, useEffect, useCallback, useRef } = React;

  const [events, setEvents]   = useState([]);      // joined rows (sync + coverage)
  const [stats, setStats]     = useState(null);
  const [loading, setLoading] = useState(true);
  const [dbError, setDbError] = useState(false);
  const [toast, setToast]     = useState('');
  const [filter, setFilter]   = useState({ status: '', year: '', q: '' });
  const [years, setYears]     = useState([]);

  const [probing, setProbing]           = useState({});   // { [id]: true }
  const [liveData, setLiveData]         = useState({});   // { [id]: probeResult }
  const [bulkProgress, setBulkProgress] = useState(null); // { current, total, code }
  const [menuOpen, setMenuOpen]         = useState(null); // event id whose ⋯ menu is open

  // Concurrent load tracking (robust version carried over from Reconcile panel).
  const [activeLoads, setActiveLoads] = useState({});
  const pollersRef  = useRef({});
  const removersRef = useRef({});

  function isPast(ev) {
    if (!ev.event_date) return true;
    const t = new Date(); t.setHours(0, 0, 0, 0);
    return new Date(ev.event_date) < t;
  }

  // ---- data load ----------------------------------------------------------
  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (filter.status) params.set('status', filter.status);
    if (filter.year)   params.set('year', filter.year);
    if (filter.q)      params.set('q', filter.q);
    try {
      const [evRes, rcRes] = await Promise.all([
        api(`/api/events?${params}`),
        api('/api/nyrr/reconcile'),
      ]);
      if (evRes.db_error) { setDbError(true); setLoading(false); return; }
      setDbError(false);
      const cov = {};
      if (rcRes.ok) (rcRes.events || []).forEach(c => { cov[c.id] = c; });
      const rows = (evRes.ok ? evRes.data : []).map(ev => ({ ...ev, ...(cov[ev.id] || {}) }));
      setEvents(rows);
    } catch (e) {
      setToast('Load error: ' + e.message);
    } finally {
      setLoading(false);
    }
  }, [filter]);

  const loadStats = () => api('/api/stats').then(r => { if (r.ok) setStats(r.data); });
  const loadYears = () => api('/api/stats/years').then(r => r.ok && setYears(r.data));

  useEffect(() => { loadStats(); loadYears(); }, []);
  useEffect(() => { load(); }, [load]);

  // ---- finisher load + polling (sync-lens actions) ------------------------
  const stopPolling = (id) => {
    if (pollersRef.current[id]) { pollersRef.current[id](); delete pollersRef.current[id]; }
  };
  const scheduleRemove = (id, delay = 4000) => {
    if (removersRef.current[id]) clearTimeout(removersRef.current[id]);
    removersRef.current[id] = setTimeout(() => {
      setActiveLoads(prev => { const n = { ...prev }; delete n[id]; return n; });
      delete removersRef.current[id];
      load();
    }, delay);
  };

  const triggerLoad = async (ev, forceReload = false, mmrOnly = false) => {
    setMenuOpen(null);
    if (activeLoads[ev.id] && !['done', 'error', 'cancelled'].includes(activeLoads[ev.id].status)) {
      setToast(`${ev.event_code} is already loading`); return;
    }
    setActiveLoads(prev => ({ ...prev, [ev.id]: {
      eventCode: ev.event_code, eventName: ev.event_name,
      status: 'starting', message: 'Starting…', step: null,
      rows_written: 0, teams_processed: 0, startedAt: Date.now(), forceReload,
    }}));
    try {
      const r = await api(`/api/load/${ev.id}`, {
        method: 'POST',
        body: JSON.stringify({ force_reload: forceReload, mmr_only: mmrOnly }),
      });
      if (!r.ok) {
        setActiveLoads(prev => prev[ev.id] ? { ...prev, [ev.id]: { ...prev[ev.id], status: 'error', message: r.error || 'Failed to start' } } : prev);
        scheduleRemove(ev.id); return;
      }
    } catch (e) {
      setActiveLoads(prev => prev[ev.id] ? { ...prev, [ev.id]: { ...prev[ev.id], status: 'error', message: e.message } } : prev);
      scheduleRemove(ev.id); return;
    }
    const intervalId = setInterval(async () => {
      try {
        const s = await api(`/api/load/${ev.event_code}/status`);
        if (s && s.status && s.status !== 'not_found') {
          setActiveLoads(prev => prev[ev.id] ? { ...prev, [ev.id]: { ...prev[ev.id], ...s } } : prev);
          if (['done', 'error', 'cancelled'].includes(s.status)) {
            stopPolling(ev.id);
            scheduleRemove(ev.id, s.status === 'done' ? 4000 : 8000);
          }
        }
      } catch (e) {
        stopPolling(ev.id);
        setActiveLoads(prev => prev[ev.id] ? { ...prev, [ev.id]: { ...prev[ev.id], status: 'error', message: 'Poll error: ' + e.message } } : prev);
        scheduleRemove(ev.id, 8000);
      }
    }, 3000);
    pollersRef.current[ev.id] = () => clearInterval(intervalId);
  };

  const cancelLoad = async (id, code) => {
    try { await api(`/api/load/${code}/cancel`, { method: 'POST' }); }
    catch (e) { setToast('Cancel error: ' + e.message); }
  };

  const tagMmrOne = async (ev) => {
    setMenuOpen(null);
    setToast(`Re-tagging MMR for ${ev.event_code}...`);
    try {
      const r = await api(`/api/nyrr/reconcile/${ev.id}/tag-mmr`, { method: 'POST' });
      if (r.ok) { setToast(`✅ ${ev.event_code}: ${r.before_mmr} → ${r.after_mmr} MMR (+${r.updated} re-tagged, +${r.inserted} inserted)`); load(); }
      else setToast(`❌ ${ev.event_code}: ${r.error || 'tag-mmr failed'}`);
    } catch (e) { setToast('Tag MMR error: ' + e.message); }
  };

  const clearAndReload = (ev) => {
    setMenuOpen(null);
    if (window.confirm(`Clear all runner data for "${ev.event_name}" and reload from scratch?`)) {
      triggerLoad(ev, true);
    }
  };

  // ---- probe (coverage-lens actions) --------------------------------------
  const probe = async (ev) => {
    setMenuOpen(null);
    setProbing(p => ({ ...p, [ev.id]: true }));
    try {
      const r = await api(`/api/nyrr/reconcile/${ev.id}/probe`, { method: 'POST' });
      if (r.ok) {
        setLiveData(d => ({ ...d, [ev.id]: r }));
        setEvents(evs => evs.map(e => e.id === ev.id ? { ...e,
          nyrr_total: r.nyrr_total, nyrr_mmr: r.nyrr_mmr,
          ...(r.marked_complete ? { processing_status: 'Completed' } : {}),
          ...(r.demoted ? { processing_status: 'Pending' } : {}) } : e));
        if (r.marked_complete) setToast(`✅ ${ev.event_code} marked Completed (${r.db_total}/${r.nyrr_total})`);
        else if (r.demoted)    setToast(`⬇️ ${ev.event_code} demoted to Pending (${r.db_total}/${r.nyrr_total}, ${r.pct}%)`);
      } else setToast(r.error || 'Probe failed');
    } catch (e) { setToast('Probe error: ' + e.message); }
    finally { setProbing(p => { const n = { ...p }; delete n[ev.id]; return n; }); }
  };

  const probeAll = async () => {
    const past = events.filter(isPast);
    try {
      for (let i = 0; i < past.length; i++) {
        setBulkProgress({ current: i + 1, total: past.length, code: past[i].event_code });
        await probe(past[i]);
      }
    } finally { setBulkProgress(null); }
  };

  // ---- discovery / batch --------------------------------------------------
  const discoverEvents = async () => {
    const year = filter.year || new Date().getFullYear();
    setToast(`Discovering events for ${year}...`);
    try {
      const r = await api('/api/discover', { method: 'POST', body: JSON.stringify({ year: parseInt(year) }) });
      if (r.ok) { setToast(`Found ${r.api_total} events, ${r.new_inserted} new inserted.`); load(); loadStats(); loadYears(); }
      else setToast(r.error || 'Discovery failed');
    } catch (e) { setToast('Discovery error: ' + e.message); }
  };
  const discoverUpcoming = async () => {
    setToast('Fetching upcoming events from NYRR...');
    try {
      const r = await api('/api/discover-upcoming', { method: 'POST' });
      if (r.ok) { setToast(`Found ${r.api_total} upcoming events, ${r.new_inserted} new inserted.`); load(); loadStats(); loadYears(); }
      else setToast(r.error || 'Failed to fetch upcoming events');
    } catch (e) { setToast('Discovery error: ' + e.message); }
  };
  const tagMmrBatch = async () => {
    if (!window.confirm('Re-tag MMR runners on every past event with 0 MMR? This calls NYRR teams/teamRunners for each event (may take a few minutes). Safe — UPDATE-only, no destructive ops.')) return;
    setToast('Reconciling MMR tags across past events (this may take a while)...');
    try {
      const r = await api('/api/nyrr/reconcile/tag-mmr-batch', { method: 'POST', body: JSON.stringify({ only_zero_mmr: true, since: '2024-01-01', limit: 500 }) });
      if (r.ok) {
        const recovered = (r.events || []).filter(e => e.ok && e.after_mmr > 0).length;
        setToast(`✅ Processed ${r.processed} events; recovered MMR tags on ${recovered}. Failed: ${r.failed || 0}.`); load();
      } else setToast(r.error || 'Batch reconcile failed');
    } catch (e) { setToast('Batch error: ' + e.message); }
  };

  // cleanup timers on unmount
  useEffect(() => () => {
    Object.values(pollersRef.current).forEach(fn => fn());
    Object.values(removersRef.current).forEach(id => clearTimeout(id));
  }, []);

  return {
    // state
    events, stats, loading, dbError, toast, setToast, filter, setFilter, years,
    probing, liveData, bulkProgress, menuOpen, setMenuOpen, activeLoads,
    // actions
    load, triggerLoad, cancelLoad, tagMmrOne, clearAndReload,
    probe, probeAll, discoverEvents, discoverUpcoming, tagMmrBatch,
    // helpers
    isPast,
  };
};
