// NyrrActivityRail — always-on "what's hitting NYRR right now" strip.
//
// Answers the "we don't know what's running" problem: polls /api/nyrr/activity
// (cheap, read-only) and shows process-wide rate-limit health + in-flight load
// jobs in one place. Rendered at the top of the NyrrEvents view.
//
// Scope note: only reflects activity in the admin web-app process. CLI and
// GitHub Action runs are separate processes and won't appear here.
initComponent('NyrrActivityRail', () => {
  const { useState, useEffect, useRef } = React;

  const [data, setData]   = useState(null);   // { throttle, jobs, active_count }
  const [error, setError] = useState(false);
  const timerRef = useRef(null);

  const poll = async () => {
    try {
      const r = await api('/api/nyrr/activity');
      if (r && r.ok) { setData(r); setError(false); }
      else setError(true);
    } catch (e) { setError(true); }
  };

  useEffect(() => {
    poll();
    timerRef.current = setInterval(poll, 4000);
    return () => clearInterval(timerRef.current);
  }, []);

  const t = data && data.throttle ? data.throttle : null;
  const backingOff = t && t.health === 'backing_off';
  const jobs = (data && data.jobs) || [];

  // Health chip colors.
  const chipBg = error ? 'rgba(148,163,184,0.15)'
    : backingOff ? 'rgba(245,158,11,0.15)' : 'rgba(34,197,94,0.12)';
  const chipFg = error ? 'var(--text2)' : backingOff ? '#f59e0b' : '#22c55e';
  const dot = error ? '⚪' : backingOff ? '🟡' : '🟢';

  const healthLabel = error ? 'NYRR status unknown'
    : backingOff ? 'NYRR rate-limited — backing off'
    : 'NYRR API healthy';

  const stepShort = (s) => ({
    init: 'starting', step1_finishers: 'finishers',
    step2_teams: 'teams', step3_backfill: 'team backfill', complete: 'finishing',
  }[s] || s || '');

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
      padding: '6px 12px', marginBottom: 12, borderRadius: 8,
      border: '1px solid var(--border)', background: 'var(--panel, rgba(255,255,255,0.02))',
      fontSize: 12,
    }}>
      {/* Health chip */}
      <span style={{
        display: 'inline-flex', alignItems: 'center', gap: 6,
        padding: '3px 10px', borderRadius: 999, background: chipBg,
        color: chipFg, fontWeight: 600, whiteSpace: 'nowrap',
      }}>
        {dot} {healthLabel}
      </span>

      {/* Backoff detail */}
      {t && (t.in_backoff > 0 || t.total_429 > 0) && (
        <span style={{ color: 'var(--text2)' }}>
          {t.in_backoff > 0 && <b style={{ color: '#f59e0b' }}>{t.in_backoff} retrying now · </b>}
          {t.total_429 > 0 && `${t.total_429} rate-limit hit${t.total_429 === 1 ? '' : 's'}`}
          {t.last_429_age_sec !== null && t.last_429_age_sec !== undefined && t.total_429 > 0 &&
            ` · last ${Math.round(t.last_429_age_sec)}s ago`}
        </span>
      )}

      {/* Divider */}
      <span style={{ color: 'var(--border)' }}>|</span>

      {/* Active jobs */}
      {jobs.length === 0 ? (
        <span style={{ color: 'var(--text2)' }}>No loads running</span>
      ) : (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ color: 'var(--accent)', fontWeight: 600 }}>
            <span className="spinner" style={{ marginRight: 4 }} />
            {jobs.length} load{jobs.length === 1 ? '' : 's'} running
          </span>
          {jobs.slice(0, 6).map(j => (
            <span key={j.event_code} style={{
              fontFamily: 'monospace', fontSize: 11, color: 'var(--text2)',
              padding: '2px 6px', borderRadius: 4, background: 'rgba(127,127,127,0.12)',
            }} title={j.message || ''}>
              {j.event_code}{j.step ? ` · ${stepShort(j.step)}` : ''}
            </span>
          ))}
          {jobs.length > 6 && <span style={{ color: 'var(--text2)' }}>+{jobs.length - 6} more</span>}
        </span>
      )}

      {/* Total requests counter (subtle, right-aligned) */}
      {t && (
        <span style={{ marginLeft: 'auto', color: 'var(--text2)' }} title="NYRR API requests this process">
          {t.total_requests.toLocaleString()} req
        </span>
      )}
    </div>
  );
});
