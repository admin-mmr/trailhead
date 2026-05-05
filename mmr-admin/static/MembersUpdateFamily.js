/**
 * Members → Update Family sub-tab
 * Search a Family primary member, view its family roster, remove members,
 * and assign a FamilyID if the primary doesn't have one yet.
 *
 * The "Add member to family" panel is its own component (MembersAddToFamily).
 *
 * Props:
 *   setToast(msg) — called from parent when an operation succeeds
 */

initComponent('MembersUpdateFamily', ({ setToast }) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [selectedMember, setSelectedMember] = useState(null);
  const [familyInfo, setFamilyInfo] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [assigningFamilyId, setAssigningFamilyId] = useState(false);

  const searchMembers = async (q) => {
    if (!q.trim()) { setSearchResults([]); return; }
    setLoading(true);
    setError('');
    const r = await api(`/api/members/search?q=${encodeURIComponent(q.trim())}`);
    if (r.ok) setSearchResults(r.data);
    else { setError(r.error || 'Search failed'); setSearchResults([]); }
    setLoading(false);
  };

  const selectPrimaryMember = async (member) => {
    setSelectedMember(member);
    setError('');
    setFamilyInfo(null);

    if (member.Type !== 'Family') {
      setError(`Member ${member.MemberID} is not a Family member (Type: ${member.Type})`);
      return;
    }

    setLoading(true);
    const r = await api(`/api/members/${member.MemberID}/family`);
    setLoading(false);

    if (r.ok) setFamilyInfo(r.data);
    else setError(r.error || 'Failed to load family info');
  };

  const assignFamilyId = async () => {
    if (!selectedMember) return;
    setAssigningFamilyId(true);
    setError('');
    const r = await api('/api/members/family/assign-family-id', {
      method: 'POST',
      body: JSON.stringify({ member_id: selectedMember.MemberID }),
    });
    setAssigningFamilyId(false);
    if (r.ok) {
      setToast(`✓ Assigned FamilyID ${r.data.family_id} to ${selectedMember.MemberID}`);
      const refreshR = await api(`/api/members/${selectedMember.MemberID}/family`);
      if (refreshR.ok) setFamilyInfo(refreshR.data);
    } else {
      setError(r.error || 'Failed to assign FamilyID');
    }
  };

  const removeMemberFromFamily = async (memberToRemove) => {
    if (!window.confirm(`Remove ${memberToRemove.MemberID} from family and revert to individual status?`)) return;

    setLoading(true);
    setError('');
    // Revert to individual; keep payment info from family membership
    const r = await api('/api/members/family/remove-member', {
      method: 'POST',
      body: JSON.stringify({
        member_id: memberToRemove.MemberID,
        old_state: {
          Type: 'Individual',
          FamilyID: null,
          Expiration: memberToRemove.Expiration,
          MembershipFeePaid: memberToRemove.MembershipFeePaid,
          PaymentDate: memberToRemove.PaymentDate,
          PaymentTransaction: memberToRemove.PaymentTransaction,
        },
      }),
    });
    setLoading(false);
    if (r.ok) {
      setToast(`✓ ${memberToRemove.MemberID} removed from family and reverted to individual`);
      const refreshR = await api(`/api/members/${selectedMember.MemberID}/family`);
      if (refreshR.ok) setFamilyInfo(refreshR.data);
    } else {
      setError(r.error || 'Failed to remove member');
    }
  };

  // Live search debounce for primary-member search
  useEffect(() => {
    if (selectedMember) return;
    const t = setTimeout(() => searchMembers(searchQuery), 300);
    return () => clearTimeout(t);
  }, [searchQuery]);

  const goBack = () => {
    setSelectedMember(null);
    setFamilyInfo(null);
    setSearchQuery('');
    setSearchResults([]);
    setError('');
  };

  return (
    <div className="panel" style={{ padding: 16 }}>
      <h3 style={{ fontSize: 15, fontWeight: 600, marginBottom: 12 }}>Update Family</h3>

      {/* Step 1: Search for primary member */}
      {!selectedMember && (
        <div style={{ marginBottom: 20 }}>
          <p style={{ fontSize: 13, color: 'var(--text2)', marginBottom: 8 }}>
            Step 1: Search for a Family member (primary member)
          </p>
          <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
            <input
              type="text"
              placeholder="Enter name or MemberID…"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              style={{ flex: 1, padding: '8px 12px', background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: 'var(--radius)', fontSize: 14 }}
            />
          </div>

          {error && <div style={{ color: 'var(--red)', fontSize: 13, marginBottom: 12 }}>{error}</div>}

          {searchResults.length > 0 && (
            <div className="panel">
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Member ID</th><th>Name</th><th>Type</th><th>Family ID</th><th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {searchResults.map(m => (
                      <tr key={m.MemberID} onClick={() => selectPrimaryMember(m)} style={{ cursor: 'pointer' }}>
                        <td style={{ fontWeight: 500 }}>{m.MemberID}</td>
                        <td>{m.FirstName} {m.LastName}</td>
                        <td><span className={`badge ${m.Type === 'Family' ? 'badge-blue' : 'badge-yellow'}`}>{m.Type}</span></td>
                        <td>{m.FamilyID || '—'}</td>
                        <td><span className={`badge ${m.Status === 'active' ? 'badge-green' : 'badge-yellow'}`}>{m.Status}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Step 2: Show family + add/remove */}
      {selectedMember && (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
            <button className="back-btn" onClick={goBack}>← Back</button>
            <span style={{ fontSize: 14, fontWeight: 500 }}>
              Primary Member: <strong>{selectedMember.MemberID}</strong> ({selectedMember.FirstName} {selectedMember.LastName})
            </span>
          </div>

          {error && (
            <div style={{ marginBottom: 12 }}>
              <div style={{ color: 'var(--red)', fontSize: 13, marginBottom: error.includes('has no FamilyID') ? 8 : 0 }}>{error}</div>
              {error.includes('has no FamilyID') && (
                <button
                  className="btn btn-primary btn-sm"
                  onClick={assignFamilyId}
                  disabled={assigningFamilyId}
                >
                  {assigningFamilyId ? 'Assigning…' : 'Assign FamilyID'}
                </button>
              )}
            </div>
          )}

          {loading ? (
            <div className="loading"><span className="spinner" /> Loading family…</div>
          ) : familyInfo ? (
            <div>
              <h4 style={{ fontSize: 13, fontWeight: 600, marginBottom: 12 }}>Family Members ({familyInfo.members.length})</h4>
              <div className="panel" style={{ marginBottom: 20 }}>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Member ID</th><th>Name</th><th>Type</th><th>Status</th><th>Expiration</th><th style={{ width: 100 }}></th>
                      </tr>
                    </thead>
                    <tbody>
                      {familyInfo.members.map(m => (
                        <tr key={m.MemberID}>
                          <td style={{ fontWeight: 500 }}>{m.MemberID}</td>
                          <td>{m.FirstName} {m.LastName}</td>
                          <td><span className={`badge ${m.Type === 'Family' ? 'badge-blue' : 'badge-yellow'}`}>{m.Type}</span></td>
                          <td><span className={`badge ${m.Status === 'active' ? 'badge-green' : 'badge-yellow'}`}>{m.Status}</span></td>
                          <td style={{ fontSize: 13, color: 'var(--text2)' }}>
                            {m.Expiration ? m.Expiration.split('T')[0] : '—'}
                          </td>
                          <td>
                            {m.MemberID !== selectedMember.MemberID && (
                              <button
                                className="btn btn-sm btn-outline"
                                style={{ color: 'var(--red)', borderColor: 'var(--red)' }}
                                onClick={() => removeMemberFromFamily(m)}
                                disabled={loading}
                              >
                                Remove
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Add member sub-panel (separate component) */}
              {window.MembersAddToFamily && React.createElement(window.MembersAddToFamily, {
                primaryMember: selectedMember,
                onAdded: (refreshed) => setFamilyInfo(refreshed),
                setToast,
              })}
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
});
