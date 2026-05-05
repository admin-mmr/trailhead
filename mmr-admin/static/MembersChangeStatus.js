/**
 * Members Status → Change Status sub-tab
 * Set a member's status to lifetime or inactive (cascades to family).
 *
 * Props:
 *   setToast(msg) — parent toast hook
 */

initComponent('MembersChangeStatus', ({ setToast }) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [selectedMember, setSelectedMember] = useState(null);
  const [searching, setSearching] = useState(false);
  const [newStatus, setNewStatus] = useState('lifetime');
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

  const changeStatus = async () => {
    if (!selectedMember) { setError('Please select a member'); return; }
    if (!note.trim()) { setError('A note is required'); return; }
    setSaving(true);
    setError('');
    const r = await api(`/api/members/${selectedMember.MemberID}/status`, {
      method: 'POST',
      body: JSON.stringify({ new_status: newStatus, note: note.trim() }),
    });
    setSaving(false);
    if (r.ok) {
      setToast(`✓ ${selectedMember.MemberID} set to ${newStatus}`);
      setSelectedMember(r.data.updated_member);
      setNote('');
    } else {
      setError(r.error || 'Status change failed');
    }
  };

  return (
    <div>
      <div style={{ marginBottom: 16, fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.6, background: 'rgba(251,146,60,0.08)', border: '1px solid rgba(251,146,60,0.25)', borderRadius: 6, padding: '12px 16px' }}>
        <strong>Lifetime</strong> — Expiration auto-set to 2126-03-31 by DB trigger; family members cascaded.<br />
        <strong>Inactive</strong> — Member left the club; no expiration change. Family members cascaded.
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

      <div style={{ display: 'flex', gap: 12, marginBottom: 12, alignItems: 'center' }}>
        <label style={{ fontWeight: 500 }}>New status:</label>
        {['lifetime', 'inactive'].map(s => (
          <label key={s} style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
            <input type="radio" name="newStatus" value={s} checked={newStatus === s} onChange={() => setNewStatus(s)} />
            <span style={{ textTransform: 'capitalize', fontWeight: newStatus === s ? 600 : 400 }}>{s}</span>
          </label>
        ))}
      </div>

      <label style={{ display: 'block', marginBottom: 6, fontWeight: 500 }}>Note <span style={{ color: '#f87171' }}>*</span></label>
      <textarea
        value={note}
        onChange={e => setNote(e.target.value)}
        placeholder="Reason for status change (required)"
        rows={2}
        style={{ width: '100%', maxWidth: 480, padding: '8px 10px', borderRadius: 4, border: '1px solid var(--border)', background: 'var(--bg-input)', color: 'var(--text)', resize: 'vertical', marginBottom: 12 }}
      />

      {error && <div style={{ color: '#f87171', marginBottom: 10, fontSize: 13 }}>⚠ {error}</div>}

      <button
        onClick={changeStatus}
        disabled={saving || !selectedMember || !note.trim()}
        style={{ padding: '8px 20px', borderRadius: 4, border: 'none', background: newStatus === 'lifetime' ? '#8b5cf6' : '#6b7280', color: '#fff', fontWeight: 600, cursor: 'pointer', opacity: (saving || !selectedMember || !note.trim()) ? 0.5 : 1 }}
      >
        {saving ? 'Saving…' : `Set ${newStatus}`}
      </button>
    </div>
  );
});
