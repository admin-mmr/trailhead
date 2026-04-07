/**
 * Members Status Management Panel
 * Handles lifetime/inactive status changes and reversions
 */

window.MembersStatusPanel = () => {
  const { useState } = React;

  // Sub-tab: change-status | revert-status
  const [subTab, setSubTab] = useState('change-status');

  // ──────────────────────────────────────────────────
  // Change Status state
  // ──────────────────────────────────────────────────
  const [statusSearchQuery, setStatusSearchQuery] = useState('');
  const [statusSearchResults, setStatusSearchResults] = useState([]);
  const [selectedStatusMember, setSelectedStatusMember] = useState(null);
  const [statusSearching, setStatusSearching] = useState(false);
  const [newStatus, setNewStatus] = useState('lifetime');
  const [statusNote, setStatusNote] = useState('');
  const [statusSaving, setStatusSaving] = useState(false);
  const [statusError, setStatusError] = useState('');
  const [statusToast, setStatusToast] = useState('');

  // ──────────────────────────────────────────────────
  // Revert Status state
  // ──────────────────────────────────────────────────
  const [revertSearchQuery, setRevertSearchQuery] = useState('');
  const [revertSearchResults, setRevertSearchResults] = useState([]);
  const [selectedRevertMember, setSelectedRevertMember] = useState(null);
  const [revertSearching, setRevertSearching] = useState(false);
  const [overrides, setOverrides] = useState([]);
  const [selectedOverrideId, setSelectedOverrideId] = useState(null);
  const [revertNote, setRevertNote] = useState('');
  const [revertSaving, setRevertSaving] = useState(false);
  const [revertError, setRevertError] = useState('');

  // ──────────────────────────────────────────────────
  // Change Status helpers
  // ──────────────────────────────────────────────────

  const searchStatusMembers = async (q) => {
    if (!q.trim()) { setStatusSearchResults([]); return; }
    setStatusSearching(true);
    const r = await api(`/api/members/search?q=${encodeURIComponent(q.trim())}`);
    setStatusSearching(false);
    if (r.ok) setStatusSearchResults(r.data);
    else { setStatusError(r.error || 'Search failed'); setStatusSearchResults([]); }
  };

  const changeStatus = async () => {
    if (!selectedStatusMember) { setStatusError('Please select a member'); return; }
    if (!statusNote.trim()) { setStatusError('A note is required'); return; }
    setStatusSaving(true);
    setStatusError('');
    const r = await api(`/api/members/${selectedStatusMember.MemberID}/status`, {
      method: 'POST',
      body: JSON.stringify({ new_status: newStatus, note: statusNote.trim() }),
    });
    setStatusSaving(false);
    if (r.ok) {
      setStatusToast(`✓ ${selectedStatusMember.MemberID} set to ${newStatus}`);
      setSelectedStatusMember(r.data.updated_member);
      setStatusNote('');
    } else {
      setStatusError(r.error || 'Status change failed');
    }
  };

  // ──────────────────────────────────────────────────
  // Revert Status helpers
  // ──────────────────────────────────────────────────

  const searchRevertMembers = async (q) => {
    if (!q.trim()) { setRevertSearchResults([]); return; }
    setRevertSearching(true);
    const r = await api(`/api/members/search?q=${encodeURIComponent(q.trim())}`);
    setRevertSearching(false);
    if (r.ok) setRevertSearchResults(r.data);
    else { setRevertError(r.error || 'Search failed'); setRevertSearchResults([]); }
  };

  const selectRevertMember = async (member) => {
    setSelectedRevertMember(member);
    setOverrides([]);
    setSelectedOverrideId(null);
    setRevertError('');
    const r = await api(`/api/members/${member.MemberID}/overrides`);
    if (r.ok) setOverrides(r.data);
    else setRevertError(r.error || 'Failed to load history');
  };

  const revertStatus = async () => {
    if (!selectedRevertMember || !selectedOverrideId) { setRevertError('Select a member and an override to revert'); return; }
    setRevertSaving(true);
    setRevertError('');
    const r = await api(`/api/members/${selectedRevertMember.MemberID}/revert-status`, {
      method: 'POST',
      body: JSON.stringify({ override_id: selectedOverrideId, note: revertNote.trim() || 'Status reverted by admin' }),
    });
    setRevertSaving(false);
    if (r.ok) {
      setStatusToast(`✓ ${selectedRevertMember.MemberID} reverted to ${r.data.reverted_to}`);
      setSelectedRevertMember(r.data.updated_member);
      const refreshed = await api(`/api/members/${r.data.updated_member.MemberID}/overrides`);
      if (refreshed.ok) setOverrides(refreshed.data);
      setSelectedOverrideId(null);
      setRevertNote('');
    } else {
      setRevertError(r.error || 'Revert failed');
    }
  };

  // ──────────────────────────────────────────────────
  // Render
  // ──────────────────────────────────────────────────

  return (
    <div>
      <h2 style={{ marginBottom: 16 }}>Member Status Management</h2>

      {/* Sub-tabs */}
      <div className="tabs" style={{ marginBottom: 24 }}>
        <button className={`tab ${subTab === 'change-status' ? 'active' : ''}`} onClick={() => setSubTab('change-status')}>👤 Change Status</button>
        <button className={`tab ${subTab === 'revert-status' ? 'active' : ''}`} onClick={() => setSubTab('revert-status')}>↩ Revert Status</button>
      </div>

      {/* Toast */}
      {statusToast && (
        <div className="toast" style={{ marginBottom: 16 }}>
          {statusToast}
          <button style={{ marginLeft: 'auto', background: 'none', border: 'none', color: 'inherit', cursor: 'pointer' }} onClick={() => setStatusToast('')}>✕</button>
        </div>
      )}

      {/* ──────────────────────────────────────────────
          Change Status sub-tab
      ────────────────────────────────────────────── */}
      {subTab === 'change-status' && (
        <div>
          <div style={{ marginBottom: 16, fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.6, background: 'rgba(251,146,60,0.08)', border: '1px solid rgba(251,146,60,0.25)', borderRadius: 6, padding: '12px 16px' }}>
            <strong>Lifetime</strong> — Expiration auto-set to 2126-03-31 by DB trigger; family members cascaded.<br />
            <strong>Inactive</strong> — Member left the club; no expiration change. Family members cascaded.
          </div>

          {/* Member search */}
          <label style={{ display: 'block', marginBottom: 6, fontWeight: 500 }}>Search member</label>
          <input
            type="text" value={statusSearchQuery} placeholder="Name / ID / WeChat"
            onChange={e => { setStatusSearchQuery(e.target.value); searchStatusMembers(e.target.value); }}
            style={{ padding: '8px 12px', borderRadius: 4, border: '1px solid var(--border)', background: 'var(--bg-input)', color: 'var(--text)', width: 280, marginBottom: 8 }}
          />
          {statusSearching && <span style={{ marginLeft: 8, color: 'var(--text-muted)' }}>Searching…</span>}

          {statusSearchResults.length > 0 && !selectedStatusMember && (
            <ul style={{ listStyle: 'none', margin: 0, padding: 0, border: '1px solid var(--border)', borderRadius: 4, maxHeight: 220, overflowY: 'auto', marginBottom: 12 }}>
              {statusSearchResults.map(m => (
                <li key={m.MemberID}
                  onClick={() => { setSelectedStatusMember(m); setStatusSearchResults([]); setStatusError(''); }}
                  style={{ padding: '8px 12px', cursor: 'pointer', borderBottom: '1px solid var(--border)', fontSize: 13 }}
                >
                  <strong>{m.MemberID}</strong> — {m.FirstName} {m.LastName} <span style={{ color: 'var(--text-muted)' }}>({m.Status})</span>
                </li>
              ))}
            </ul>
          )}

          {selectedStatusMember && (
            <div style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid var(--border)', borderRadius: 6, padding: '14px 16px', marginBottom: 16 }}>
              <div style={{ fontWeight: 600, marginBottom: 4 }}>{selectedStatusMember.MemberID} — {selectedStatusMember.FirstName} {selectedStatusMember.LastName}</div>
              <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                Current status: <strong style={{ color: 'var(--text)' }}>{selectedStatusMember.Status}</strong> &nbsp;|&nbsp;
                Expiration: <strong style={{ color: 'var(--text)' }}>{selectedStatusMember.Expiration || '—'}</strong> &nbsp;|&nbsp;
                Type: {selectedStatusMember.Type} &nbsp;|&nbsp;
                Family: {selectedStatusMember.FamilyID || 'none'}
              </div>
              <button style={{ marginTop: 8, fontSize: 12, padding: '2px 8px', background: 'transparent', border: '1px solid var(--border)', borderRadius: 3, cursor: 'pointer', color: 'var(--text-muted)' }}
                onClick={() => { setSelectedStatusMember(null); setStatusSearchQuery(''); setStatusSearchResults([]); }}>
                ✕ Change
              </button>
            </div>
          )}

          {/* Status selector */}
          <div style={{ display: 'flex', gap: 12, marginBottom: 12, alignItems: 'center' }}>
            <label style={{ fontWeight: 500 }}>New status:</label>
            {['lifetime', 'inactive'].map(s => (
              <label key={s} style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                <input type="radio" name="newStatus" value={s} checked={newStatus === s} onChange={() => setNewStatus(s)} />
                <span style={{ textTransform: 'capitalize', fontWeight: newStatus === s ? 600 : 400 }}>{s}</span>
              </label>
            ))}
          </div>

          {/* Note */}
          <label style={{ display: 'block', marginBottom: 6, fontWeight: 500 }}>Note <span style={{ color: '#f87171' }}>*</span></label>
          <textarea
            value={statusNote}
            onChange={e => setStatusNote(e.target.value)}
            placeholder="Reason for status change (required)"
            rows={2}
            style={{ width: '100%', maxWidth: 480, padding: '8px 10px', borderRadius: 4, border: '1px solid var(--border)', background: 'var(--bg-input)', color: 'var(--text)', resize: 'vertical', marginBottom: 12 }}
          />

          {statusError && <div style={{ color: '#f87171', marginBottom: 10, fontSize: 13 }}>⚠ {statusError}</div>}

          <button
            onClick={changeStatus}
            disabled={statusSaving || !selectedStatusMember || !statusNote.trim()}
            style={{ padding: '8px 20px', borderRadius: 4, border: 'none', background: newStatus === 'lifetime' ? '#8b5cf6' : '#6b7280', color: '#fff', fontWeight: 600, cursor: 'pointer', opacity: (statusSaving || !selectedStatusMember || !statusNote.trim()) ? 0.5 : 1 }}
          >
            {statusSaving ? 'Saving…' : `Set ${newStatus}`}
          </button>
        </div>
      )}

      {/* ──────────────────────────────────────────────
          Revert Status sub-tab
      ────────────────────────────────────────────── */}
      {subTab === 'revert-status' && (
        <div>
          <div style={{ marginBottom: 16, fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.6, background: 'rgba(56,189,248,0.08)', border: '1px solid rgba(56,189,248,0.2)', borderRadius: 6, padding: '12px 16px' }}>
            Reverts a member to their previous status using the <strong>admin_member_overrides</strong> audit log.
            Family members are cascaded automatically. The override note is removed from members.Notes.
          </div>

          {/* Member search */}
          <label style={{ display: 'block', marginBottom: 6, fontWeight: 500 }}>Search member</label>
          <input
            type="text" value={revertSearchQuery} placeholder="Name / ID / WeChat"
            onChange={e => { setRevertSearchQuery(e.target.value); searchRevertMembers(e.target.value); }}
            style={{ padding: '8px 12px', borderRadius: 4, border: '1px solid var(--border)', background: 'var(--bg-input)', color: 'var(--text)', width: 280, marginBottom: 8 }}
          />
          {revertSearching && <span style={{ marginLeft: 8, color: 'var(--text-muted)' }}>Searching…</span>}

          {revertSearchResults.length > 0 && !selectedRevertMember && (
            <ul style={{ listStyle: 'none', margin: 0, padding: 0, border: '1px solid var(--border)', borderRadius: 4, maxHeight: 220, overflowY: 'auto', marginBottom: 12 }}>
              {revertSearchResults.map(m => (
                <li key={m.MemberID}
                  onClick={() => { selectRevertMember(m); setRevertSearchResults([]); }}
                  style={{ padding: '8px 12px', cursor: 'pointer', borderBottom: '1px solid var(--border)', fontSize: 13 }}
                >
                  <strong>{m.MemberID}</strong> — {m.FirstName} {m.LastName} <span style={{ color: 'var(--text-muted)' }}>({m.Status})</span>
                </li>
              ))}
            </ul>
          )}

          {selectedRevertMember && (
            <div style={{ marginBottom: 16 }}>
              <div style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid var(--border)', borderRadius: 6, padding: '12px 16px', marginBottom: 12 }}>
                <div style={{ fontWeight: 600 }}>{selectedRevertMember.MemberID} — {selectedRevertMember.FirstName} {selectedRevertMember.LastName}</div>
                <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 4 }}>
                  Current status: <strong style={{ color: 'var(--text)' }}>{selectedRevertMember.Status}</strong> &nbsp;|&nbsp;
                  Expiration: {selectedRevertMember.Expiration || '—'}
                </div>
                <button style={{ marginTop: 8, fontSize: 12, padding: '2px 8px', background: 'transparent', border: '1px solid var(--border)', borderRadius: 3, cursor: 'pointer', color: 'var(--text-muted)' }}
                  onClick={() => { setSelectedRevertMember(null); setOverrides([]); setRevertSearchQuery(''); setRevertSearchResults([]); setSelectedOverrideId(null); }}>
                  ✕ Change
                </button>
              </div>

              {/* Override history */}
              {overrides.length === 0 ? (
                <div style={{ fontSize: 13, color: 'var(--text-muted)', padding: '10px 0' }}>No admin overrides on record for this member.</div>
              ) : (
                <>
                  <div style={{ fontWeight: 500, marginBottom: 8 }}>Select override to revert:</div>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, marginBottom: 16 }}>
                    <thead>
                      <tr style={{ borderBottom: '1px solid var(--border)' }}>
                        {['', 'Date', 'Action', 'From → To', 'Admin', 'Note'].map(h => (
                          <th key={h} style={{ padding: '6px 8px', textAlign: 'left', color: 'var(--text-muted)', fontWeight: 500 }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {overrides.map(ov => (
                        <tr key={ov.OverrideID}
                          onClick={() => setSelectedOverrideId(ov.OverrideID)}
                          style={{ borderBottom: '1px solid rgba(255,255,255,0.05)', cursor: 'pointer', background: selectedOverrideId === ov.OverrideID ? 'rgba(139,92,246,0.12)' : 'transparent' }}
                        >
                          <td style={{ padding: '6px 8px' }}>
                            <input type="radio" checked={selectedOverrideId === ov.OverrideID} readOnly />
                          </td>
                          <td style={{ padding: '6px 8px', whiteSpace: 'nowrap' }}>{ov.Timestamp?.split('T')[0]}</td>
                          <td style={{ padding: '6px 8px' }}>{ov.ActionType}</td>
                          <td style={{ padding: '6px 8px' }}>{ov.OldValue} → {ov.NewValue}</td>
                          <td style={{ padding: '6px 8px', color: 'var(--text-muted)', fontSize: 12 }}>{ov.AdminEmail}</td>
                          <td style={{ padding: '6px 8px', color: 'var(--text-muted)', fontSize: 12, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ov.AdminNotes}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>

                  {selectedOverrideId && (
                    <>
                      <div style={{ marginBottom: 6, fontWeight: 500, fontSize: 13 }}>
                        Will revert to: <strong style={{ color: '#a78bfa' }}>
                          {overrides.find(o => o.OverrideID === selectedOverrideId)?.OldValue}
                        </strong>
                        {' '}(family members cascaded)
                      </div>
                      <input
                        type="text" value={revertNote}
                        onChange={e => setRevertNote(e.target.value)}
                        placeholder="Optional note (default: 'Status reverted by admin')"
                        style={{ width: '100%', maxWidth: 480, padding: '7px 10px', borderRadius: 4, border: '1px solid var(--border)', background: 'var(--bg-input)', color: 'var(--text)', marginBottom: 10 }}
                      />
                    </>
                  )}

                  {revertError && <div style={{ color: '#f87171', marginBottom: 10, fontSize: 13 }}>⚠ {revertError}</div>}

                  <button
                    onClick={revertStatus}
                    disabled={!selectedOverrideId || revertSaving}
                    style={{ padding: '8px 20px', borderRadius: 4, border: 'none', background: selectedOverrideId ? '#0ea5e9' : '#374151', color: selectedOverrideId ? '#fff' : '#6b7280', fontWeight: 600, cursor: selectedOverrideId ? 'pointer' : 'not-allowed' }}
                  >
                    {revertSaving ? 'Reverting…' : '↩ Revert Status'}
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
