/**
 * Members → Upgrade to Family sub-tab
 * Convert an Individual member to Family type, generate a new FamilyID, and
 * add a second member to that family in one step.
 *
 * Props:
 *   setToast(msg) — called from parent on success
 */

initComponent('MembersUpgradeFamily', ({ setToast }) => {
  const [upgPrimaryQuery, setUpgPrimaryQuery] = useState('');
  const [upgPrimaryResults, setUpgPrimaryResults] = useState([]);
  const [upgPrimary, setUpgPrimary] = useState(null);

  const [upgSecondQuery, setUpgSecondQuery] = useState('');
  const [upgSecondResults, setUpgSecondResults] = useState([]);
  const [upgSecond, setUpgSecond] = useState(null);

  const [upgSearching, setUpgSearching] = useState(false);
  const [upgSecondSearching, setUpgSecondSearching] = useState(false);
  const [upgError, setUpgError] = useState('');
  const [upgSaving, setUpgSaving] = useState(false);
  const [upgResult, setUpgResult] = useState(null);

  const searchUpgPrimary = async (q) => {
    if (!q.trim()) { setUpgPrimaryResults([]); return; }
    setUpgSearching(true);
    setUpgError('');
    const r = await api(`/api/members/search?q=${encodeURIComponent(q.trim())}`);
    setUpgSearching(false);
    if (r.ok) setUpgPrimaryResults(r.data);
    else { setUpgError(r.error || 'Search failed'); setUpgPrimaryResults([]); }
  };

  const searchUpgSecond = async (q) => {
    if (!q.trim()) { setUpgSecondResults([]); return; }
    setUpgSecondSearching(true);
    setUpgError('');
    const r = await api(`/api/members/search?q=${encodeURIComponent(q.trim())}`);
    setUpgSecondSearching(false);
    if (r.ok) setUpgSecondResults(r.data);
    else { setUpgError(r.error || 'Search failed'); setUpgSecondResults([]); }
  };

  const upgradeAndAdd = async () => {
    if (!upgPrimary || !upgSecond) {
      setUpgError('Select both the primary member and the member to add');
      return;
    }
    setUpgSaving(true);
    setUpgError('');
    const r = await api('/api/members/family/upgrade-and-add', {
      method: 'POST',
      body: JSON.stringify({
        primary_member_id: upgPrimary.MemberID,
        new_member_id: upgSecond.MemberID,
      }),
    });
    setUpgSaving(false);
    if (r.ok) {
      setUpgResult(r.data);
      setToast(`✓ ${r.data.message}`);
      setUpgPrimary(null); setUpgPrimaryQuery(''); setUpgPrimaryResults([]);
      setUpgSecond(null);  setUpgSecondQuery('');  setUpgSecondResults([]);
    } else {
      setUpgError(r.error || 'Upgrade failed');
    }
  };

  return (
    <div className="panel" style={{ padding: 16 }}>
      <h3 style={{ fontSize: 15, fontWeight: 600, marginBottom: 4 }}>Upgrade Individual → Family</h3>
      <p style={{ fontSize: 13, color: 'var(--text2)', marginBottom: 16 }}>
        Converts an Individual member to Family type, generates a new FamilyID, and adds a second member to that family in one step.
      </p>

      {upgError && (
        <div className="error" style={{ marginBottom: 12 }}>{upgError}</div>
      )}

      {/* Step 1: Primary member */}
      <div style={{ marginBottom: 20 }}>
        <p style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Step 1 — Select primary member (must be Individual)</p>
        <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
          <input
            type="text"
            placeholder="Search by name or MemberID…"
            value={upgPrimaryQuery}
            onChange={e => { setUpgPrimaryQuery(e.target.value); searchUpgPrimary(e.target.value); }}
            style={{ flex: 1, padding: '6px 10px', border: '1px solid var(--border)', borderRadius: 4, background: 'var(--bg2)', color: 'var(--text1)' }}
          />
          {upgSearching && <span style={{ alignSelf: 'center', fontSize: 12, color: 'var(--text2)' }}>Searching…</span>}
        </div>
        {!upgPrimary && upgPrimaryResults.length > 0 && (
          <div style={{ border: '1px solid var(--border)', borderRadius: 4, maxHeight: 180, overflowY: 'auto' }}>
            {upgPrimaryResults.map(m => (
              <div
                key={m.MemberID}
                onClick={() => { setUpgPrimary(m); setUpgPrimaryResults([]); setUpgError(''); }}
                style={{ padding: '8px 12px', cursor: 'pointer', borderBottom: '1px solid var(--border)', fontSize: 13 }}
                className="hover-row"
              >
                <strong>{m.MemberID}</strong> — {m.FirstName} {m.LastName}
                <span style={{ marginLeft: 8, fontSize: 11, color: 'var(--text2)' }}>{m.Type} · {m.Status}</span>
                {m.FamilyID && <span style={{ marginLeft: 8, fontSize: 11, color: 'var(--warn)' }}> (already in family {m.FamilyID})</span>}
              </div>
            ))}
          </div>
        )}
        {upgPrimary && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', background: 'var(--bg2)', borderRadius: 4, border: '1px solid var(--border)' }}>
            <span style={{ fontSize: 13 }}><strong>{upgPrimary.MemberID}</strong> — {upgPrimary.FirstName} {upgPrimary.LastName} · {upgPrimary.Type} · {upgPrimary.Status}</span>
            <button className="btn btn-sm" onClick={() => { setUpgPrimary(null); setUpgPrimaryQuery(''); setUpgError(''); }}>✕</button>
          </div>
        )}
      </div>

      {/* Step 2: Second member */}
      <div style={{ marginBottom: 24 }}>
        <p style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Step 2 — Select member to add to the new family</p>
        <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
          <input
            type="text"
            placeholder="Search by name or MemberID…"
            value={upgSecondQuery}
            onChange={e => { setUpgSecondQuery(e.target.value); searchUpgSecond(e.target.value); }}
            style={{ flex: 1, padding: '6px 10px', border: '1px solid var(--border)', borderRadius: 4, background: 'var(--bg2)', color: 'var(--text1)' }}
          />
          {upgSecondSearching && <span style={{ alignSelf: 'center', fontSize: 12, color: 'var(--text2)' }}>Searching…</span>}
        </div>
        {!upgSecond && upgSecondResults.length > 0 && (
          <div style={{ border: '1px solid var(--border)', borderRadius: 4, maxHeight: 180, overflowY: 'auto' }}>
            {upgSecondResults.map(m => (
              <div
                key={m.MemberID}
                onClick={() => { setUpgSecond(m); setUpgSecondResults([]); setUpgError(''); }}
                style={{ padding: '8px 12px', cursor: 'pointer', borderBottom: '1px solid var(--border)', fontSize: 13 }}
                className="hover-row"
              >
                <strong>{m.MemberID}</strong> — {m.FirstName} {m.LastName}
                <span style={{ marginLeft: 8, fontSize: 11, color: 'var(--text2)' }}>{m.Type} · {m.Status}</span>
                {m.FamilyID && <span style={{ marginLeft: 8, fontSize: 11, color: 'var(--warn)' }}> (already in family {m.FamilyID})</span>}
              </div>
            ))}
          </div>
        )}
        {upgSecond && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', background: 'var(--bg2)', borderRadius: 4, border: '1px solid var(--border)' }}>
            <span style={{ fontSize: 13 }}><strong>{upgSecond.MemberID}</strong> — {upgSecond.FirstName} {upgSecond.LastName} · {upgSecond.Type} · {upgSecond.Status}</span>
            <button className="btn btn-sm" onClick={() => { setUpgSecond(null); setUpgSecondQuery(''); setUpgError(''); }}>✕</button>
          </div>
        )}
      </div>

      {/* Confirm */}
      <button
        className="btn btn-primary"
        onClick={upgradeAndAdd}
        disabled={upgSaving || !upgPrimary || !upgSecond}
      >
        {upgSaving ? 'Upgrading…' : 'Upgrade to Family & Add Member'}
      </button>

      {/* Result */}
      {upgResult && (
        <div style={{ marginTop: 20, padding: 12, background: 'var(--bg2)', borderRadius: 4, border: '1px solid var(--border)' }}>
          <p style={{ fontWeight: 600, marginBottom: 8, fontSize: 13 }}>✓ Family created: {upgResult.family_id}</p>
          <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border)' }}>
                <th style={{ textAlign: 'left', padding: '4px 8px' }}>MemberID</th>
                <th style={{ textAlign: 'left', padding: '4px 8px' }}>Name</th>
                <th style={{ textAlign: 'left', padding: '4px 8px' }}>Type</th>
                <th style={{ textAlign: 'left', padding: '4px 8px' }}>Status</th>
                <th style={{ textAlign: 'left', padding: '4px 8px' }}>Expiration</th>
              </tr>
            </thead>
            <tbody>
              {upgResult.members.map(m => (
                <tr key={m.MemberID} style={{ borderBottom: '1px solid var(--border)' }}>
                  <td style={{ padding: '4px 8px', fontFamily: 'monospace' }}>{m.MemberID}</td>
                  <td style={{ padding: '4px 8px' }}>{m.FirstName} {m.LastName}</td>
                  <td style={{ padding: '4px 8px' }}>{m.Type}</td>
                  <td style={{ padding: '4px 8px' }}>{m.Status}</td>
                  <td style={{ padding: '4px 8px' }}>{m.Expiration || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <button className="btn btn-sm" style={{ marginTop: 10 }} onClick={() => setUpgResult(null)}>Dismiss</button>
        </div>
      )}
    </div>
  );
});
