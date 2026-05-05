/**
 * Members Status → Restore from Log sub-tab
 * Browse the member_log audit trail and restore any historical Status +
 * Expiration. Cascades to family members. A note is required.
 *
 * Props:
 *   setToast(msg) — parent toast hook
 */

initComponent('MembersRestoreLog', ({ setToast }) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [selectedMember, setSelectedMember] = useState(null);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selectedLogId, setSelectedLogId] = useState(null);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const searchMembers = async (q) => {
    if (!q.trim()) { setSearchResults([]); return; }
    setSearching(true);
    const r = await api(`/api/members/search?q=${encodeURIComponent(q.trim())}`);
    setSearching(false);
    if (r.ok) setSearchResults(r.data);
    else { setError(r.error || 'Search failed'); setSearchResults([]); }
  };

  const selectMember = async (member) => {
    setSelectedMember(member);
    setSearchResults([]);
    setSelectedLogId(null);
    setError('');
    setLoading(true);
    const r = await api(`/api/members/${member.MemberID}/log-history`);
    setLoading(false);
    if (r.ok) setHistory(r.data.log);
    else setError(r.error || 'Failed to load log history');
  };

  const restore = async () => {
    if (!selectedMember || !selectedLogId) return;
    setSaving(true);
    setError('');
    const r = await api(`/api/members/${selectedMember.MemberID}/restore-from-log`, {
      method: 'POST',
      body: JSON.stringify({ log_id: selectedLogId, note: note.trim() }),
    });
    setSaving(false);
    if (r.ok) {
      setToast(`✓ ${selectedMember.MemberID} restored — status=${r.data.restored_status}, expiration=${r.data.restored_expiration || 'unchanged'}`);
      setSelectedMember(r.data.updated_member);
      setSelectedLogId(null);
      setNote('');
      const refreshed = await api(`/api/members/${r.data.updated_member.MemberID}/log-history`);
      if (refreshed.ok) setHistory(refreshed.data.log);
    } else {
      setError(r.error || 'Restore failed');
    }
  };

  const logRowDiffers = (row, member) =>
    (row.Status && row.Status !== member.Status) ||
    (row.Expiration && row.Expiration !== (member.Expiration || '').split('T')[0]);

  return (
    <div>
      <div style={{ marginBottom: 16, fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.6, background: 'rgba(251,191,36,0.08)', border: '1px solid rgba(251,191,36,0.25)', borderRadius: 6, padding: '12px 16px' }}>
        <strong>Restore from member_log</strong> — Browse the full audit trail (Sheets syncs, payment events, every recorded change)
        and restore any historical Status + Expiration. Cascades to family members. A note is required.
      </div>

      <label style={{ display: 'block', marginBottom: 6, fontWeight: 500 }}>Search member</label>
      <input
        type="text" value={searchQuery} placeholder="Name / ID / WeChat"
        onChange={e => { setSearchQuery(e.target.value); searchMembers(e.target.value); }}
        style={{ padding: '8px 12px', borderRadius: 4, border: '1px solid var(--border)', background: 'var(--bg-input)', color: 'var(--text)', width: 280, marginBottom: 8 }}
      />
      {searching && <span style={{ marginLeft: 8, color: 'var(--text-muted)' }}>Searching…</span>}

      {searchResults.length > 0 && !selectedMember && (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, border: '1px solid var(--border)', borderRadius: 4, maxHeight: 220, overflowY: 'auto', marginBottom: 12 }}>
          {searchResults.map(m => (
            <li key={m.MemberID}
              onClick={() => selectMember(m)}
              style={{ padding: '8px 12px', cursor: 'pointer', borderBottom: '1px solid var(--border)', fontSize: 13 }}
            >
              <strong>{m.MemberID}</strong> — {m.FirstName} {m.LastName} <span style={{ color: 'var(--text-muted)' }}>({m.Status})</span>
            </li>
          ))}
        </ul>
      )}

      {selectedMember && (
        <div>
          <div style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid var(--border)', borderRadius: 6, padding: '12px 16px', marginBottom: 16 }}>
            <div style={{ fontWeight: 600, marginBottom: 4 }}>
              {selectedMember.MemberID} — {selectedMember.FirstName} {selectedMember.LastName}
            </div>
            <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
              Current status: <strong style={{ color: 'var(--text)' }}>{selectedMember.Status}</strong>
              &nbsp;|&nbsp;
              Expiration: <strong style={{ color: 'var(--text)' }}>{selectedMember.Expiration || '—'}</strong>
              &nbsp;|&nbsp;
              Type: {selectedMember.Type}
              {selectedMember.FamilyID && <>&nbsp;|&nbsp;Family: {selectedMember.FamilyID}</>}
            </div>
            <button
              style={{ marginTop: 8, fontSize: 12, padding: '2px 8px', background: 'transparent', border: '1px solid var(--border)', borderRadius: 3, cursor: 'pointer', color: 'var(--text-muted)' }}
              onClick={() => { setSelectedMember(null); setSearchQuery(''); setHistory([]); setSelectedLogId(null); setError(''); }}
            >
              ✕ Change
            </button>
          </div>

          {loading && <div style={{ color: 'var(--text-muted)', fontSize: 13, marginBottom: 12 }}>Loading log history…</div>}

          {!loading && history.length === 0 && (
            <div style={{ fontSize: 13, color: 'var(--text-muted)', padding: '10px 0' }}>No log entries found for this member.</div>
          )}

          {!loading && history.length > 0 && (
            <>
              <div style={{ fontWeight: 500, marginBottom: 8 }}>
                Select snapshot to restore ({history.length} entries — <span style={{ color: '#fbbf24' }}>highlighted rows differ from current</span>):
              </div>
              <div style={{ maxHeight: 340, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 6, marginBottom: 16 }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead style={{ position: 'sticky', top: 0, background: 'var(--surface)', zIndex: 1 }}>
                    <tr style={{ borderBottom: '1px solid var(--border)' }}>
                      {['', 'Date / Time', 'Change Type', 'Status', 'Expiration', 'Fee Paid'].map(h => (
                        <th key={h} style={{ padding: '7px 10px', textAlign: 'left', color: 'var(--text-muted)', fontWeight: 500, whiteSpace: 'nowrap' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {history.map(row => {
                      const differs = logRowDiffers(row, selectedMember);
                      const isSelected = selectedLogId === row.LogID;
                      return (
                        <tr
                          key={row.LogID}
                          onClick={() => setSelectedLogId(row.LogID)}
                          style={{
                            borderBottom: '1px solid rgba(255,255,255,0.05)',
                            cursor: 'pointer',
                            background: isSelected
                              ? 'rgba(251,191,36,0.15)'
                              : differs
                                ? 'rgba(251,191,36,0.04)'
                                : 'transparent',
                          }}
                        >
                          <td style={{ padding: '7px 10px' }}>
                            <input type="radio" readOnly checked={isSelected} />
                          </td>
                          <td style={{ padding: '7px 10px', whiteSpace: 'nowrap', color: 'var(--text-muted)', fontSize: 12 }}>
                            {row.LoggingTime?.replace('T', ' ').slice(0, 16)}
                          </td>
                          <td style={{ padding: '7px 10px', fontSize: 12 }}>{row.ChangeType || '—'}</td>
                          <td style={{ padding: '7px 10px', fontWeight: row.Status !== selectedMember.Status ? 600 : 400,
                            color: row.Status !== selectedMember.Status ? '#fbbf24' : 'inherit' }}>
                            {row.Status || '—'}
                          </td>
                          <td style={{ padding: '7px 10px', whiteSpace: 'nowrap',
                            fontWeight: row.Expiration && row.Expiration !== (selectedMember.Expiration || '').slice(0, 10) ? 600 : 400,
                            color: row.Expiration && row.Expiration !== (selectedMember.Expiration || '').slice(0, 10) ? '#fbbf24' : 'inherit' }}>
                            {row.Expiration || '—'}
                          </td>
                          <td style={{ padding: '7px 10px', color: 'var(--text-muted)', fontSize: 12 }}>
                            {row.MembershipFeePaid != null ? `$${row.MembershipFeePaid}` : '—'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {selectedLogId && (() => {
                const snap = history.find(r => r.LogID === selectedLogId);
                return snap ? (
                  <div style={{ background: 'rgba(251,191,36,0.08)', border: '1px solid rgba(251,191,36,0.3)', borderRadius: 6, padding: '14px 16px', marginBottom: 16 }}>
                    <div style={{ fontWeight: 600, marginBottom: 8 }}>Preview restore</div>
                    <table style={{ fontSize: 13, borderCollapse: 'collapse' }}>
                      <thead>
                        <tr>
                          <th style={{ padding: '4px 16px 4px 0', color: 'var(--text-muted)', fontWeight: 400, textAlign: 'left' }}></th>
                          <th style={{ padding: '4px 24px 4px 0', color: 'var(--text-muted)', fontWeight: 500 }}>Current</th>
                          <th style={{ padding: '4px 0', color: '#fbbf24', fontWeight: 500 }}>→ Will become</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr>
                          <td style={{ padding: '3px 16px 3px 0', color: 'var(--text-muted)' }}>Status</td>
                          <td style={{ padding: '3px 24px 3px 0' }}>{selectedMember.Status}</td>
                          <td style={{ fontWeight: snap.Status !== selectedMember.Status ? 700 : 400, color: snap.Status !== selectedMember.Status ? '#fbbf24' : 'inherit' }}>
                            {snap.Status || '(unchanged)'}
                          </td>
                        </tr>
                        <tr>
                          <td style={{ padding: '3px 16px 3px 0', color: 'var(--text-muted)' }}>Expiration</td>
                          <td style={{ padding: '3px 24px 3px 0' }}>{(selectedMember.Expiration || '').slice(0, 10) || '—'}</td>
                          <td style={{ fontWeight: snap.Expiration && snap.Expiration !== (selectedMember.Expiration || '').slice(0, 10) ? 700 : 400,
                            color: snap.Expiration && snap.Expiration !== (selectedMember.Expiration || '').slice(0, 10) ? '#fbbf24' : 'inherit' }}>
                            {snap.Expiration || '(unchanged)'}
                          </td>
                        </tr>
                      </tbody>
                    </table>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 8 }}>
                      Snapshot from: {snap.LoggingTime?.replace('T', ' ').slice(0, 16)} ({snap.ChangeType || 'unknown change type'})
                      {selectedMember.FamilyID && ' · Family members will be cascaded'}
                    </div>

                    <label style={{ display: 'block', marginTop: 12, marginBottom: 6, fontWeight: 500, fontSize: 13 }}>
                      Note <span style={{ color: '#f87171' }}>*</span>
                    </label>
                    <input
                      type="text"
                      value={note}
                      onChange={e => setNote(e.target.value)}
                      placeholder="e.g. Reverting erroneous sync from April 10"
                      style={{ width: '100%', maxWidth: 460, padding: '7px 10px', borderRadius: 4, border: '1px solid var(--border)', background: 'var(--bg-input)', color: 'var(--text)', marginBottom: 12 }}
                    />

                    {error && <div style={{ color: '#f87171', marginBottom: 10, fontSize: 13 }}>⚠ {error}</div>}

                    <div style={{ display: 'flex', gap: 10 }}>
                      <button
                        onClick={restore}
                        disabled={saving || !note.trim()}
                        style={{ padding: '8px 20px', borderRadius: 4, border: 'none', background: note.trim() ? '#d97706' : '#374151', color: note.trim() ? '#fff' : '#6b7280', fontWeight: 600, cursor: note.trim() ? 'pointer' : 'not-allowed' }}
                      >
                        {saving ? 'Restoring…' : '📋 Confirm Restore'}
                      </button>
                      <button
                        onClick={() => { setSelectedLogId(null); setNote(''); setError(''); }}
                        style={{ padding: '8px 16px', borderRadius: 4, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer' }}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : null;
              })()}
            </>
          )}
        </div>
      )}
    </div>
  );
});
