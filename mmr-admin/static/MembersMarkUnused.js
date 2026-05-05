/**
 * Members → Mark as Unused sub-tab
 * Sets Status → inactive, FirstName → Unused, LastName → MemberID,
 * District → Other, Email → <memberid>@mmrunners.org.
 *
 * Props:
 *   setToast(msg) — called from parent on success
 */

initComponent('MembersMarkUnused', ({ setToast }) => {
  const [unusedQuery, setUnusedQuery] = useState('');
  const [unusedResults, setUnusedResults] = useState([]);
  const [unusedSearching, setUnusedSearching] = useState(false);
  const [selectedUnusedMember, setSelectedUnusedMember] = useState(null);
  const [unusedSaving, setUnusedSaving] = useState(false);
  const [unusedError, setUnusedError] = useState('');

  const runSearch = async () => {
    if (unusedQuery.trim().length < 2) return;
    setUnusedSearching(true);
    const r = await api(`/api/members/search?q=${encodeURIComponent(unusedQuery.trim())}`);
    setUnusedResults(r.ok ? r.data : []);
    setUnusedSearching(false);
  };

  const confirmMarkUnused = async () => {
    setUnusedSaving(true);
    setUnusedError('');
    const r = await api(`/api/members/${selectedUnusedMember.MemberID}/mark-unused`, { method: 'POST' });
    setUnusedSaving(false);
    if (r.ok) {
      setToast(`✓ ${selectedUnusedMember.MemberID} marked as unused`);
      setSelectedUnusedMember(null);
      setUnusedQuery('');
      setUnusedResults([]);
    } else {
      setUnusedError(r.error || 'Failed to mark as unused');
    }
  };

  return (
    <div className="panel" style={{ padding: 16 }}>
      <h3 style={{ fontSize: 15, fontWeight: 600, marginBottom: 12 }}>Mark as Unused</h3>
      <p style={{ fontSize: 13, color: 'var(--text2)', marginBottom: 16 }}>
        Sets Status → inactive, FirstName → Unused, LastName → MemberID, District → Other, and assigns a placeholder email.
      </p>

      {/* Search */}
      {!selectedUnusedMember && (
        <div style={{ marginBottom: 20 }}>
          <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
            <input
              type="text"
              placeholder="Enter name or MemberID…"
              value={unusedQuery}
              onChange={e => setUnusedQuery(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') runSearch(); }}
              style={{ flex: 1, padding: '8px 12px', background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: 'var(--radius)', fontSize: 14 }}
            />
            <button
              className="btn btn-sm"
              disabled={unusedSearching || unusedQuery.trim().length < 2}
              onClick={runSearch}
            >
              {unusedSearching ? 'Searching…' : 'Search'}
            </button>
          </div>

          {unusedResults.length > 0 && (
            <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)' }}>
                  <th style={{ textAlign: 'left', padding: '6px 8px' }}>ID</th>
                  <th style={{ textAlign: 'left', padding: '6px 8px' }}>Name</th>
                  <th style={{ textAlign: 'left', padding: '6px 8px' }}>Status</th>
                  <th style={{ textAlign: 'left', padding: '6px 8px' }}>District</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {unusedResults.map(m => (
                  <tr key={m.MemberID} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={{ padding: '6px 8px' }}>{m.MemberID}</td>
                    <td style={{ padding: '6px 8px' }}>{m.FirstName} {m.LastName}</td>
                    <td style={{ padding: '6px 8px' }}><span className={`badge ${m.Status === 'active' ? 'badge-green' : 'badge-yellow'}`}>{m.Status}</span></td>
                    <td style={{ padding: '6px 8px' }}>{m.District || '—'}</td>
                    <td style={{ padding: '6px 8px' }}>
                      <button className="btn btn-sm" onClick={() => { setSelectedUnusedMember(m); setUnusedError(''); }}>Select</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* Confirm */}
      {selectedUnusedMember && (
        <div>
          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: 14, marginBottom: 16 }}>
            <div style={{ fontSize: 13, marginBottom: 4 }}><strong>{selectedUnusedMember.MemberID}</strong> — {selectedUnusedMember.FirstName} {selectedUnusedMember.LastName}</div>
            <div style={{ fontSize: 12, color: 'var(--text2)' }}>Status: {selectedUnusedMember.Status} · District: {selectedUnusedMember.District || '—'} · {selectedUnusedMember.Email}</div>
          </div>

          <div style={{ fontSize: 13, color: 'var(--text2)', marginBottom: 12 }}>
            This will set: <strong>Status → inactive</strong>, <strong>FirstName → Unused</strong>, <strong>LastName → {selectedUnusedMember.MemberID}</strong>, <strong>District → Other</strong>, Email → {selectedUnusedMember.MemberID.toLowerCase()}@mmrunners.org
          </div>

          {unusedError && <div style={{ color: 'var(--danger)', fontSize: 13, marginBottom: 10 }}>{unusedError}</div>}

          <div style={{ display: 'flex', gap: 8 }}>
            <button
              className="btn btn-danger"
              disabled={unusedSaving}
              onClick={confirmMarkUnused}
            >
              {unusedSaving ? 'Saving…' : 'Confirm — Mark as Unused'}
            </button>
            <button
              className="btn btn-outline"
              disabled={unusedSaving}
              onClick={() => { setSelectedUnusedMember(null); setUnusedError(''); }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
});
