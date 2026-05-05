/**
 * Members → Change District sub-tab
 * Search a member, pick a new district, persist via API.
 *
 * Props:
 *   setToast(msg) — called from parent on success
 */

initComponent('MembersChangeDistrict', ({ setToast }) => {
  const [districts, setDistricts] = useState([]);
  const [districtSearchQuery, setDistrictSearchQuery] = useState('');
  const [districtSearchResults, setDistrictSearchResults] = useState([]);
  const [selectedDistrictMember, setSelectedDistrictMember] = useState(null);
  const [selectedDistrict, setSelectedDistrict] = useState('');
  const [districtSearching, setDistrictSearching] = useState(false);
  const [districtError, setDistrictError] = useState('');
  const [districtSaving, setDistrictSaving] = useState(false);

  // Load districts on mount
  useEffect(() => {
    (async () => {
      const r = await api('/api/districts');
      if (r.ok) setDistricts(r.data);
    })();
  }, []);

  const searchDistrictMembers = async (q) => {
    if (!q.trim()) { setDistrictSearchResults([]); return; }
    setDistrictSearching(true);
    setDistrictError('');
    const r = await api(`/api/members/search?q=${encodeURIComponent(q.trim())}`);
    if (r.ok) setDistrictSearchResults(r.data);
    else { setDistrictError(r.error || 'Search failed'); setDistrictSearchResults([]); }
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

  // Live search debounce
  useEffect(() => {
    if (selectedDistrictMember) return;
    const t = setTimeout(() => searchDistrictMembers(districtSearchQuery), 300);
    return () => clearTimeout(t);
  }, [districtSearchQuery]);

  return (
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
              style={{ flex: 1, padding: '8px 12px', background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: 'var(--radius)', fontSize: 14 }}
            />
          </div>

          {districtError && <div style={{ color: 'var(--red)', fontSize: 13, marginBottom: 12 }}>{districtError}</div>}

          {districtSearchResults.length > 0 && (
            <div className="panel">
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Member ID</th><th>Name</th><th>Current District</th><th>Status</th>
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
                style={{ width: '100%', padding: '8px 12px', background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: 'var(--radius)', fontSize: 14 }}
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
  );
});
