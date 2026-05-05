/**
 * Members Status → Mark Active sub-tab
 * Sets status=active and expiration=MembershipYearEnd; cascades to family.
 *
 * Props:
 *   setToast(msg) — parent toast hook
 */

initComponent('MembersMarkActive', ({ setToast }) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [selectedMember, setSelectedMember] = useState(null);
  const [searching, setSearching] = useState(false);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [yearEnd, setYearEnd] = useState(null);
  const [yearEndLoading, setYearEndLoading] = useState(false);

  // Load year-end on first render
  useEffect(() => {
    setYearEndLoading(true);
    api('/api/members/config/year-end').then(r => {
      setYearEndLoading(false);
      if (r.ok) setYearEnd(r.data.year_end);
      else setError(r.error || 'Could not load MembershipYearEnd from config');
    });
  }, []);

  const searchMembers = async (q) => {
    if (!q.trim()) { setSearchResults([]); return; }
    setSearching(true);
    const r = await api(`/api/members/search?q=${encodeURIComponent(q.trim())}`);
    setSearching(false);
    if (r.ok) setSearchResults(r.data);
    else { setError(r.error || 'Search failed'); setSearchResults([]); }
  };

  const markActive = async () => {
    if (!selectedMember) { setError('Please select a member'); return; }
    if (!note.trim()) { setError('A note is required'); return; }
    setSaving(true);
    setError('');
    const r = await api(`/api/members/${selectedMember.MemberID}/mark-active`, {
      method: 'POST',
      body: JSON.stringify({ note: note.trim() }),
    });
    setSaving(false);
    if (r.ok) {
      setToast(`✓ ${selectedMember.MemberID} marked active — expiration set to ${r.data.expiration_set}`);
      setSelectedMember(r.data.updated_member);
      setNote('');
    } else {
      setError(r.error || 'Mark active failed');
    }
  };

  return (
    <div>
      <div style={{ marginBottom: 16, fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.6, background: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.25)', borderRadius: 6, padding: '12px 16px' }}>
        <strong>Mark Active</strong> — Sets status to <strong>active</strong> and expiration to the year-end date from config (<code>MembershipYearEnd</code>).
        Cascades to all family members.
      </div>

      {yearEndLoading && <div style={{ color: 'var(--text-muted)', fontSize: 13, marginBottom: 12 }}>Loading year-end date…</div>}
      {yearEnd && !yearEndLoading && (
        <div style={{ marginBottom: 16, fontSize: 13, padding: '8px 14px', background: 'rgba(34,197,94,0.06)', border: '1px solid rgba(34,197,94,0.2)', borderRadius: 4 }}>
          Will set expiration to: <strong style={{ color: '#4ade80' }}>{yearEnd}</strong>
        </div>
      )}

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
              onClick={() => { setSelectedMember(m); setSearchResults([]); setError(''); }}
              style={{ padding: '8px 12px', cursor: 'pointer', borderBottom: '1px solid var(--border)', fontSize: 13 }}
            >
              <strong>{m.MemberID}</strong> — {m.FirstName} {m.LastName} <span style={{ color: 'var(--text-muted)' }}>({m.Status})</span>
            </li>
          ))}
        </ul>
      )}

      {selectedMember && (
        <div style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid var(--border)', borderRadius: 6, padding: '14px 16px', marginBottom: 16 }}>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>{selectedMember.MemberID} — {selectedMember.FirstName} {selectedMember.LastName}</div>
          <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
            Current status: <strong style={{ color: 'var(--text)' }}>{selectedMember.Status}</strong> &nbsp;|&nbsp;
            Expiration: <strong style={{ color: 'var(--text)' }}>{selectedMember.Expiration || '—'}</strong> &nbsp;|&nbsp;
            Type: {selectedMember.Type} &nbsp;|&nbsp;
            Family: {selectedMember.FamilyID || 'none'} &nbsp;|&nbsp;
            District: {selectedMember.District || '—'} &nbsp;|&nbsp;
            WeChat: {selectedMember.WeChatID || '—'}
          </div>
          <button style={{ marginTop: 8, fontSize: 12, padding: '2px 8px', background: 'transparent', border: '1px solid var(--border)', borderRadius: 3, cursor: 'pointer', color: 'var(--text-muted)' }}
            onClick={() => { setSelectedMember(null); setSearchQuery(''); setSearchResults([]); }}>
            ✕ Change
          </button>
        </div>
      )}

      <label style={{ display: 'block', marginBottom: 6, fontWeight: 500 }}>Note <span style={{ color: '#f87171' }}>*</span></label>
      <textarea
        value={note}
        onChange={e => setNote(e.target.value)}
        placeholder="Reason for manual activation (required)"
        rows={2}
        style={{ width: '100%', maxWidth: 480, padding: '8px 10px', borderRadius: 4, border: '1px solid var(--border)', background: 'var(--bg-input)', color: 'var(--text)', resize: 'vertical', marginBottom: 12 }}
      />

      {error && <div style={{ color: '#f87171', marginBottom: 10, fontSize: 13 }}>⚠ {error}</div>}

      <button
        onClick={markActive}
        disabled={saving || !selectedMember || !note.trim() || !yearEnd}
        style={{ padding: '8px 20px', borderRadius: 4, border: 'none', background: '#16a34a', color: '#fff', fontWeight: 600, cursor: 'pointer', opacity: (saving || !selectedMember || !note.trim() || !yearEnd) ? 0.5 : 1 }}
      >
        {saving ? 'Saving…' : '✅ Mark Active'}
      </button>
    </div>
  );
});
