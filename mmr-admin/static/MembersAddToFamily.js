/**
 * Members → Update Family → Add member sub-panel.
 *
 * Renders a search input + selectable results table + confirm/cancel for
 * adding a member to an existing family. Owns its own search state.
 *
 * Props:
 *   primaryMember     — the family's primary member (for context messages)
 *   onAdded(family)   — called with refreshed family info after a successful add
 *   setToast(msg)     — parent toast hook
 */

initComponent('MembersAddToFamily', ({ primaryMember, onAdded, setToast }) => {
  const [addSearchQuery, setAddSearchQuery] = useState('');
  const [addSearchResults, setAddSearchResults] = useState([]);
  const [selectedNewMember, setSelectedNewMember] = useState(null);
  const [addError, setAddError] = useState('');
  const [savingAdd, setSavingAdd] = useState(false);

  const searchMembersToAdd = async (q) => {
    if (!q.trim()) { setAddSearchResults([]); return; }
    setAddError('');
    const r = await api(`/api/members/search?q=${encodeURIComponent(q.trim())}`);
    if (r.ok) setAddSearchResults(r.data);
    else { setAddError(r.error || 'Search failed'); setAddSearchResults([]); }
  };

  useEffect(() => {
    const t = setTimeout(() => searchMembersToAdd(addSearchQuery), 300);
    return () => clearTimeout(t);
  }, [addSearchQuery]);

  const addMemberToFamily = async () => {
    if (!primaryMember || !selectedNewMember) {
      setAddError('Please select a member to add');
      return;
    }
    setSavingAdd(true);
    setAddError('');
    const r = await api('/api/members/family/add-member', {
      method: 'POST',
      body: JSON.stringify({
        primary_member_id: primaryMember.MemberID,
        new_member_id: selectedNewMember.MemberID,
      }),
    });
    setSavingAdd(false);
    if (r.ok) {
      setToast(`✓ ${selectedNewMember.MemberID} added to family ${primaryMember.FamilyID}`);
      onAdded && onAdded(r.data);
      setSelectedNewMember(null);
      setAddSearchQuery('');
      setAddSearchResults([]);
    } else {
      setAddError(r.error || 'Failed to add member to family');
    }
  };

  return (
    <div style={{ marginBottom: 20 }}>
      <h4 style={{ fontSize: 13, fontWeight: 600, marginBottom: 12 }}><span>+ Add Member to Family</span></h4>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <input
          type="text"
          placeholder="Search member to add…"
          value={addSearchQuery}
          onChange={e => setAddSearchQuery(e.target.value)}
          style={{ flex: 1, padding: '8px 12px', background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: 'var(--radius)', fontSize: 14 }}
        />
      </div>

      {addError && <div style={{ color: 'var(--red)', fontSize: 13, marginBottom: 12 }}>{addError}</div>}

      {!selectedNewMember && addSearchResults.length > 0 && (
        <div className="panel">
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>Member ID</th><th>Name</th><th>Type</th><th>Status</th></tr>
              </thead>
              <tbody>
                {addSearchResults.map(m => (
                  <tr key={m.MemberID} onClick={() => setSelectedNewMember(m)} style={{ cursor: 'pointer' }}>
                    <td style={{ fontWeight: 500 }}>{m.MemberID}</td>
                    <td>{m.FirstName} {m.LastName}</td>
                    <td><span className={`badge ${m.Type === 'Family' ? 'badge-blue' : 'badge-yellow'}`}>{m.Type}</span></td>
                    <td><span className={`badge ${m.Status === 'active' ? 'badge-green' : 'badge-yellow'}`}>{m.Status}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {selectedNewMember && (
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: 12, marginBottom: 12 }}>
          <div style={{ marginBottom: 12 }}>
            <p style={{ fontSize: 13, marginBottom: 4 }}>
              <strong>Member to add:</strong> {selectedNewMember.MemberID} - {selectedNewMember.FirstName} {selectedNewMember.LastName}
            </p>
            <p style={{ fontSize: 12, color: 'var(--text2)' }}>
              This member will share: Family ID, Expiration, Payment info with the primary member.
            </p>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              className="btn btn-primary"
              onClick={addMemberToFamily}
              disabled={savingAdd}
            >
              {savingAdd ? 'Adding…' : 'Confirm & Add'}
            </button>
            <button
              className="btn btn-outline"
              onClick={() => {
                setSelectedNewMember(null);
                setAddSearchQuery('');
                setAddSearchResults([]);
              }}
              disabled={savingAdd}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
});
