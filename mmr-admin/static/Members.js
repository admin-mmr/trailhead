/**
 * Members Panel component for Admin Portal
 * Sub-tabs:
 *   1. Update Family   - add/remove members from a family
 *   2. Change District - update a member's district
 *   3. Mark as Unused  - mark a member ID as unused (sets inactive, District=Other)
 *
 * Note: Status management (Change Status, Revert Status) moved to MembersStatusPanel.js
 */

const MembersPanel = () => {
  const { useState, useEffect, useCallback } = React;

  // Sub-tab selection
  const [subTab, setSubTab] = useState('update-family');

  // Update Family state
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [selectedMember, setSelectedMember] = useState(null);
  const [familyInfo, setFamilyInfo] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');

  // Add to Family state
  const [addSearchQuery, setAddSearchQuery] = useState('');
  const [addSearchResults, setAddSearchResults] = useState([]);
  const [selectedNewMember, setSelectedNewMember] = useState(null);
  const [addSearching, setAddSearching] = useState(false);
  const [addError, setAddError] = useState('');
  const [savingAdd, setSavingAdd] = useState(false);
  const [assigningFamilyId, setAssigningFamilyId] = useState(false);

  // Change District state
  const [districtSearchQuery, setDistrictSearchQuery] = useState('');
  const [districtSearchResults, setDistrictSearchResults] = useState([]);
  const [selectedDistrictMember, setSelectedDistrictMember] = useState(null);
  const [districts, setDistricts] = useState([]);
  const [selectedDistrict, setSelectedDistrict] = useState('');
  const [districtSearching, setDistrictSearching] = useState(false);
  const [districtError, setDistrictError] = useState('');
  const [districtSaving, setDistrictSaving] = useState(false);

  // Mark as Unused state
  const [unusedQuery, setUnusedQuery] = useState('');
  const [unusedResults, setUnusedResults] = useState([]);
  const [unusedSearching, setUnusedSearching] = useState(false);
  const [selectedUnusedMember, setSelectedUnusedMember] = useState(null);
  const [unusedSaving, setUnusedSaving] = useState(false);
  const [unusedError, setUnusedError] = useState('');

  // Upgrade to Family state
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

  // Load districts on mount
  useEffect(() => {
    (async () => {
      const r = await api('/api/districts');
      if (r.ok) setDistricts(r.data);
    })();
  }, []);

  // ────────────────────────────────────────────────────
  // Update Family helpers
  // ────────────────────────────────────────────────────

  const searchMembers = async (q) => {
    if (!q.trim()) {
      setSearchResults([]);
      return;
    }
    setLoading(true);
    setError('');
    const r = await api(`/api/members/search?q=${encodeURIComponent(q.trim())}`);
    if (r.ok) {
      setSearchResults(r.data);
    } else {
      setError(r.error || 'Search failed');
      setSearchResults([]);
    }
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

    // Fetch family info
    setLoading(true);
    const r = await api(`/api/members/${member.MemberID}/family`);
    setLoading(false);

    if (r.ok) {
      setFamilyInfo(r.data);
      setAddSearchQuery('');
      setAddSearchResults([]);
      setSelectedNewMember(null);
      setAddError('');
    } else {
      setError(r.error || 'Failed to load family info');
    }
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
      // Re-fetch family info now that ID is assigned
      const refreshR = await api(`/api/members/${selectedMember.MemberID}/family`);
      if (refreshR.ok) setFamilyInfo(refreshR.data);
    } else {
      setError(r.error || 'Failed to assign FamilyID');
    }
  };

  const searchMembersToAdd = async (q) => {
    if (!q.trim()) {
      setAddSearchResults([]);
      return;
    }
    setAddSearching(true);
    setAddError('');
    const r = await api(`/api/members/search?q=${encodeURIComponent(q.trim())}`);
    if (r.ok) {
      setAddSearchResults(r.data);
    } else {
      setAddError(r.error || 'Search failed');
      setAddSearchResults([]);
    }
    setAddSearching(false);
  };

  const addMemberToFamily = async () => {
    if (!selectedMember || !selectedNewMember) {
      setAddError('Please select a member to add');
      return;
    }

    setSavingAdd(true);
    setAddError('');

    const r = await api('/api/members/family/add-member', {
      method: 'POST',
      body: JSON.stringify({
        primary_member_id: selectedMember.MemberID,
        new_member_id: selectedNewMember.MemberID,
      }),
    });

    setSavingAdd(false);

    if (r.ok) {
      setToast(`✓ ${selectedNewMember.MemberID} added to family ${selectedMember.FamilyID}`);
      setFamilyInfo(r.data);
      setSelectedNewMember(null);
      setAddSearchQuery('');
      setAddSearchResults([]);
    } else {
      setAddError(r.error || 'Failed to add member to family');
    }
  };

  const removeMemberFromFamily = async (memberToRemove) => {
    if (!window.confirm(`Remove ${memberToRemove.MemberID} from family and revert to individual status?`)) return;

    setLoading(true);
    setError('');

    // Revert to individual status (no family)
    // Note: Payment info (Expiration, MembershipFeePaid, etc.) from family membership is kept
    // The member can be adjusted separately if needed
    const r = await api('/api/members/family/remove-member', {
      method: 'POST',
      body: JSON.stringify({
        member_id: memberToRemove.MemberID,
        old_state: {
          Type: 'Individual',  // Revert to individual
          FamilyID: null,       // Remove from family
          Expiration: memberToRemove.Expiration,  // Keep current (from family membership)
          MembershipFeePaid: memberToRemove.MembershipFeePaid,
          PaymentDate: memberToRemove.PaymentDate,
          PaymentTransaction: memberToRemove.PaymentTransaction,
        },
      }),
    });

    setLoading(false);

    if (r.ok) {
      setToast(`✓ ${memberToRemove.MemberID} removed from family and reverted to individual`);
      // Refresh family info
      const refreshR = await api(`/api/members/${selectedMember.MemberID}/family`);
      if (refreshR.ok) {
        setFamilyInfo(refreshR.data);
      }
    } else {
      setError(r.error || 'Failed to remove member');
    }
  };

  // ────────────────────────────────────────────────────
  // Live search debounces
  // ────────────────────────────────────────────────────

  useEffect(() => {
    if (selectedMember) return;
    const t = setTimeout(() => searchMembers(searchQuery), 300);
    return () => clearTimeout(t);
  }, [searchQuery]);

  useEffect(() => {
    const t = setTimeout(() => searchMembersToAdd(addSearchQuery), 300);
    return () => clearTimeout(t);
  }, [addSearchQuery]);

  useEffect(() => {
    if (selectedDistrictMember) return;
    const t = setTimeout(() => searchDistrictMembers(districtSearchQuery), 300);
    return () => clearTimeout(t);
  }, [districtSearchQuery]);

  // ────────────────────────────────────────────────────
  // Change District helpers
  // ────────────────────────────────────────────────────

  const searchDistrictMembers = async (q) => {
    if (!q.trim()) {
      setDistrictSearchResults([]);
      return;
    }
    setDistrictSearching(true);
    setDistrictError('');
    const r = await api(`/api/members/search?q=${encodeURIComponent(q.trim())}`);
    if (r.ok) {
      setDistrictSearchResults(r.data);
    } else {
      setDistrictError(r.error || 'Search failed');
      setDistrictSearchResults([]);
    }
    setDistrictSearching(false);
  };

  const selectDistrictMember = (member) => {
    setSelectedDistrictMember(member);
    setSelectedDistrict(member.District || '');
    setDistrictError('');
  };

  const changeDistrict = async () => {
    if (!selectedDistrictMember || !selectedDistrict) {
      setDistrictError('Please select a member and district');
      return;
    }

    setDistrictSaving(true);
    setDistrictError('');

    const r = await api(`/api/members/${selectedDistrictMember.MemberID}/district`, {
      method: 'POST',
      body: JSON.stringify({ district: selectedDistrict }),
    });

    setDistrictSaving(false);

    if (r.ok) {
      setToast(`✓ ${selectedDistrictMember.MemberID} district changed to ${selectedDistrict}`);
      setSelectedDistrictMember(r.data.updated_member);
    } else {
      setDistrictError(r.error || 'Failed to change district');
    }
  };

  // ────────────────────────────────────────────────────
  // Upgrade to Family helpers
  // ────────────────────────────────────────────────────

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
      // Reset search fields
      setUpgPrimary(null); setUpgPrimaryQuery(''); setUpgPrimaryResults([]);
      setUpgSecond(null);  setUpgSecondQuery('');  setUpgSecondResults([]);
    } else {
      setUpgError(r.error || 'Upgrade failed');
    }
  };

  // ────────────────────────────────────────────────────
  // Render
  // ────────────────────────────────────────────────────

  return (
    <div>
      <h2 style={{ marginBottom: 16 }}>Members Management</h2>

      {/* Sub-tabs */}
      <div className="tabs" style={{ marginBottom: 24 }}>
        <button className={`tab ${subTab === 'update-family' ? 'active' : ''}`} onClick={() => setSubTab('update-family')}>Update Family</button>
        <button className={`tab ${subTab === 'upgrade-to-family' ? 'active' : ''}`} onClick={() => setSubTab('upgrade-to-family')}>Upgrade to Family</button>
        <button className={`tab ${subTab === 'change-district' ? 'active' : ''}`} onClick={() => setSubTab('change-district')}>Change District</button>
        <button className={`tab ${subTab === 'change-status' ? 'active' : ''}`} onClick={() => setSubTab('change-status')}>Change Status</button>
        <button className={`tab ${subTab === 'mark-active' ? 'active' : ''}`} onClick={() => setSubTab('mark-active')}>Mark Active</button>
        <button className={`tab ${subTab === 'mark-unused' ? 'active' : ''}`} onClick={() => setSubTab('mark-unused')}>Mark as Unused</button>
        <button className={`tab ${subTab === 'revert-status' ? 'active' : ''}`} onClick={() => setSubTab('revert-status')}>Revert Status</button>
        <button className={`tab ${subTab === 'restore-log' ? 'active' : ''}`} onClick={() => setSubTab('restore-log')}>Restore from Log</button>
      </div>

      {/* Toast */}
      {toast && (
        <div
          className="toast"
          style={{ position: 'relative', bottom: 'auto', right: 'auto', marginBottom: 16 }}
          onAnimationEnd={() => setToast('')}
        >
          {toast}
        </div>
      )}

      {/* ═════════════════════════════════════════ */}
      {/* Sub-tab: Update Family */}
      {/* ═════════════════════════════════════════ */}
      {subTab === 'update-family' && (
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
                  style={{
                    flex: 1,
                    padding: '8px 12px',
                    background: 'var(--surface)',
                    border: '1px solid var(--border)',
                    color: 'var(--text)',
                    borderRadius: 'var(--radius)',
                    fontSize: 14,
                  }}
                />
              </div>

              {error && <div style={{ color: 'var(--red)', fontSize: 13, marginBottom: 12 }}>{error}</div>}

              {searchResults.length > 0 && (
                <div className="panel">
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>Member ID</th>
                          <th>Name</th>
                          <th>Type</th>
                          <th>Family ID</th>
                          <th>Status</th>
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

          {/* Step 2: Show family and add members */}
          {selectedMember && (
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
                <button
                  className="back-btn"
                  onClick={() => {
                    setSelectedMember(null);
                    setFamilyInfo(null);
                    setSearchQuery('');
                    setSearchResults([]);
                    setError('');
                  }}
                >
                  ← Back
                </button>
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
                  {/* Family members table */}
                  <h4 style={{ fontSize: 13, fontWeight: 600, marginBottom: 12 }}>Family Members ({familyInfo.members.length})</h4>
                  <div className="panel" style={{ marginBottom: 20 }}>
                    <div className="table-wrap">
                      <table>
                        <thead>
                          <tr>
                            <th>Member ID</th>
                            <th>Name</th>
                            <th>Type</th>
                            <th>Status</th>
                            <th>Expiration</th>
                            <th style={{ width: 100 }}></th>
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

                  {/* Add member section */}
                  <h4 style={{ fontSize: 13, fontWeight: 600, marginBottom: 12 }}>
                    <span>+ Add Member to Family</span>
                  </h4>
                  <div style={{ marginBottom: 20 }}>
                    <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
                      <input
                        type="text"
                        placeholder="Search member to add…"
                        value={addSearchQuery}
                        onChange={e => setAddSearchQuery(e.target.value)}
                        style={{
                          flex: 1,
                          padding: '8px 12px',
                          background: 'var(--surface)',
                          border: '1px solid var(--border)',
                          color: 'var(--text)',
                          borderRadius: 'var(--radius)',
                          fontSize: 14,
                        }}
                      />
                    </div>

                    {addError && <div style={{ color: 'var(--red)', fontSize: 13, marginBottom: 12 }}>{addError}</div>}

                    {!selectedNewMember && addSearchResults.length > 0 && (
                      <div className="panel">
                        <div className="table-wrap">
                          <table>
                            <thead>
                              <tr>
                                <th>Member ID</th>
                                <th>Name</th>
                                <th>Type</th>
                                <th>Status</th>
                              </tr>
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
                </div>
              ) : null}
            </div>
          )}
        </div>
      )}

      {/* ═════════════════════════════════════════ */}
      {/* Sub-tab: Upgrade to Family                */}
      {/* ═════════════════════════════════════════ */}
      {subTab === 'upgrade-to-family' && (
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
      )}

      {/* ═════════════════════════════════════════ */}
      {/* Sub-tab: Change District */}
      {/* ═════════════════════════════════════════ */}
      {subTab === 'change-district' && (
        <div className="panel" style={{ padding: 16 }}>
          <h3 style={{ fontSize: 15, fontWeight: 600, marginBottom: 12 }}>Change District</h3>

          {/* Search for member */}
          {!selectedDistrictMember && (
            <div style={{ marginBottom: 20 }}>
              <p style={{ fontSize: 13, color: 'var(--text2)', marginBottom: 8 }}>
                Search for a member and select a new district
              </p>
              <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
                <input
                  type="text"
                  placeholder="Enter name or MemberID…"
                  value={districtSearchQuery}
                  onChange={e => setDistrictSearchQuery(e.target.value)}
                  style={{
                    flex: 1,
                    padding: '8px 12px',
                    background: 'var(--surface)',
                    border: '1px solid var(--border)',
                    color: 'var(--text)',
                    borderRadius: 'var(--radius)',
                    fontSize: 14,
                  }}
                />
              </div>

              {districtError && <div style={{ color: 'var(--red)', fontSize: 13, marginBottom: 12 }}>{districtError}</div>}

              {districtSearchResults.length > 0 && (
                <div className="panel">
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>Member ID</th>
                          <th>Name</th>
                          <th>Current District</th>
                          <th>Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {districtSearchResults.map(m => (
                          <tr key={m.MemberID} onClick={() => selectDistrictMember(m)} style={{ cursor: 'pointer' }}>
                            <td style={{ fontWeight: 500 }}>{m.MemberID}</td>
                            <td>{m.FirstName} {m.LastName}</td>
                            <td style={{ color: 'var(--text2)' }}>{m.District || '—'}</td>
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

          {/* District selector */}
          {selectedDistrictMember && (
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
                <button
                  className="back-btn"
                  onClick={() => {
                    setSelectedDistrictMember(null);
                    setDistrictSearchQuery('');
                    setDistrictSearchResults([]);
                    setSelectedDistrict('');
                    setDistrictError('');
                  }}
                >
                  ← Back
                </button>
                <span style={{ fontSize: 14, fontWeight: 500 }}>
                  Member: <strong>{selectedDistrictMember.MemberID}</strong> ({selectedDistrictMember.FirstName} {selectedDistrictMember.LastName})
                </span>
              </div>

              <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: 16 }}>
                <div style={{ marginBottom: 16 }}>
                  <label style={{ display: 'block', fontSize: 13, fontWeight: 500, marginBottom: 4 }}>
                    Current District: <strong>{selectedDistrictMember.District || 'None'}</strong>
                  </label>
                </div>

                <div style={{ marginBottom: 16 }}>
                  <label style={{ display: 'block', fontSize: 13, fontWeight: 500, marginBottom: 8 }}>
                    New District
                  </label>
                  <select
                    value={selectedDistrict}
                    onChange={e => setSelectedDistrict(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '8px 12px',
                      background: 'var(--surface2)',
                      border: '1px solid var(--border)',
                      color: 'var(--text)',
                      borderRadius: 'var(--radius)',
                      fontSize: 14,
                    }}
                  >
                    <option value="">-- Select a district --</option>
                    {districts.map(d => (
                      <option key={d} value={d}>{d}</option>
                    ))}
                  </select>
                </div>

                {districtError && <div style={{ color: 'var(--red)', fontSize: 13, marginBottom: 12 }}>{districtError}</div>}

                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    className="btn btn-primary"
                    onClick={changeDistrict}
                    disabled={districtSaving || !selectedDistrict}
                  >
                    {districtSaving ? 'Updating…' : 'Change District'}
                  </button>
                  <button
                    className="btn btn-outline"
                    onClick={() => {
                      setSelectedDistrictMember(null);
                      setDistrictSearchQuery('');
                      setDistrictSearchResults([]);
                      setSelectedDistrict('');
                      setDistrictError('');
                    }}
                    disabled={districtSaving}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
      {/* ── Status operations (delegated to MembersStatusPanel) ── */}
      {['change-status', 'mark-active', 'revert-status', 'restore-log'].includes(subTab) && (
        <div key={subTab}>
          {window.MembersStatusPanel && React.createElement(window.MembersStatusPanel, {
            initialSubTab: subTab,
            hideNav: true,
          })}
        </div>
      )}

      {/* ── Mark as Unused ── */}
      {subTab === 'mark-unused' && (
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
                  onKeyDown={async e => {
                    if (e.key === 'Enter' && unusedQuery.trim().length >= 2) {
                      setUnusedSearching(true);
                      const r = await api(`/api/members/search?q=${encodeURIComponent(unusedQuery.trim())}`);
                      setUnusedResults(r.ok ? r.data : []);
                      setUnusedSearching(false);
                    }
                  }}
                  style={{ flex: 1, padding: '8px 12px', background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: 'var(--radius)', fontSize: 14 }}
                />
                <button
                  className="btn btn-sm"
                  disabled={unusedSearching || unusedQuery.trim().length < 2}
                  onClick={async () => {
                    setUnusedSearching(true);
                    const r = await api(`/api/members/search?q=${encodeURIComponent(unusedQuery.trim())}`);
                    setUnusedResults(r.ok ? r.data : []);
                    setUnusedSearching(false);
                  }}
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
                  onClick={async () => {
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
                  }}
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
      )}
    </div>
  );
};

// Expose for index.html
window.MembersPanel = MembersPanel;
