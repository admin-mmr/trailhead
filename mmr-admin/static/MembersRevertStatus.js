/**
 * Members Status → Revert Status sub-tab
 * List admin overrides; pick one to revert (Status + Expiration restored
 * from the snapshot taken before the override; Notes "Admin Override"
 * stanza is stripped). Cascades to all impacted members.
 *
 * Props:
 *   setToast(msg) — parent toast hook
 */

initComponent('MembersRevertStatus', ({ setToast }) => {
  const [overrides, setOverrides] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selectedOverrideId, setSelectedOverrideId] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const loadAll = async () => {
    setLoading(true);
    setError('');
    const r = await api('/api/members/overrides/all');
    setLoading(false);
    if (r.ok) setOverrides(r.data);
    else setError(r.error || 'Failed to load overrides');
  };

  useEffect(() => { loadAll(); }, []);

  const revertStatus = async () => {
    if (!selectedOverrideId) { setError('Select an override to revert'); return; }
    setSaving(true);
    setError('');
    const r = await api('/api/members/revert-override', {
      method: 'POST',
      body: JSON.stringify({ override_id: selectedOverrideId }),
    });
    setSaving(false);
    if (r.ok) {
      const count = r.data.members_restored;
      setToast(`✓ Reverted ${count} member${count !== 1 ? 's' : ''} (override #${r.data.reverted_override_id})`);
      setSelectedOverrideId(null);
      loadAll();
    } else {
      setError(r.error || 'Revert failed');
    }
  };

  return (
    <div>
      <div style={{ marginBottom: 16, fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.6, background: 'rgba(56,189,248,0.08)', border: '1px solid rgba(56,189,248,0.2)', borderRadius: 6, padding: '12px 16px' }}>
        Select any override to revert. Restores Status + Expiration for every member in the Impacted list
        from their last snapshot before the override ran. The Admin Override entry is stripped from Notes.
        <button onClick={loadAll} style={{ marginLeft: 12, fontSize: 12, padding: '2px 8px', background: 'transparent', border: '1px solid rgba(56,189,248,0.4)', borderRadius: 3, cursor: 'pointer', color: 'var(--text-muted)' }}>
          ↻ Refresh
        </button>
      </div>

      {loading && <div style={{ color: 'var(--text-muted)', fontSize: 13, padding: '12px 0' }}>Loading overrides…</div>}

      {!loading && overrides.length === 0 && (
        <div style={{ fontSize: 13, color: 'var(--text-muted)', padding: '10px 0' }}>No admin overrides on record.</div>
      )}

      {!loading && overrides.length > 0 && (
        <>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, marginBottom: 16 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border)' }}>
                {['', 'Date', 'Action', 'Target', 'From → To', 'Admin', 'Note', 'Impacted Members'].map(h => (
                  <th key={h} style={{ padding: '6px 8px', textAlign: 'left', color: 'var(--text-muted)', fontWeight: 500 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {overrides.map(ov => (
                <tr key={ov.OverrideID}
                  onClick={() => setSelectedOverrideId(ov.OverrideID === selectedOverrideId ? null : ov.OverrideID)}
                  style={{ borderBottom: '1px solid rgba(255,255,255,0.05)', cursor: 'pointer', background: selectedOverrideId === ov.OverrideID ? 'rgba(139,92,246,0.12)' : 'transparent' }}
                >
                  <td style={{ padding: '6px 8px' }}>
                    <input type="radio" checked={selectedOverrideId === ov.OverrideID} readOnly />
                  </td>
                  <td style={{ padding: '6px 8px', whiteSpace: 'nowrap' }}>{ov.Timestamp?.split('T')[0]}</td>
                  <td style={{ padding: '6px 8px' }}>{ov.ActionType}</td>
                  <td style={{ padding: '6px 8px', fontWeight: 600 }}>{ov.TargetMemberID}</td>
                  <td style={{ padding: '6px 8px' }}>{ov.OldValue} → {ov.NewValue}</td>
                  <td style={{ padding: '6px 8px', color: 'var(--text-muted)', fontSize: 12 }}>{ov.AdminEmail}</td>
                  <td style={{ padding: '6px 8px', color: 'var(--text-muted)', fontSize: 12, maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ov.AdminNotes}</td>
                  <td style={{ padding: '6px 8px', fontSize: 12 }}>
                    {ov.ImpactedMemberIDs
                      ? ov.ImpactedMemberIDs.split(',').map(id => (
                          <span key={id} style={{ display: 'inline-block', background: 'rgba(139,92,246,0.15)', border: '1px solid rgba(139,92,246,0.3)', borderRadius: 3, padding: '1px 5px', marginRight: 3, marginBottom: 2, whiteSpace: 'nowrap' }}>{id.trim()}</span>
                        ))
                      : <span style={{ color: 'var(--text-muted)' }}>—</span>
                    }
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {selectedOverrideId && (() => {
            const ov = overrides.find(o => o.OverrideID === selectedOverrideId);
            const ids = ov?.ImpactedMemberIDs ? ov.ImpactedMemberIDs.split(',').map(s => s.trim()) : [];
            return (
              <div style={{ marginBottom: 10, background: 'rgba(139,92,246,0.08)', border: '1px solid rgba(139,92,246,0.25)', borderRadius: 6, padding: '10px 14px', fontSize: 13 }}>
                <div style={{ fontWeight: 600, marginBottom: 6 }}>This revert will:</div>
                <ul style={{ margin: '0 0 6px 0', paddingLeft: 18, lineHeight: 1.8 }}>
                  <li>Restore <strong>Status</strong> and <strong>Expiration</strong> for each member from their last snapshot before this override</li>
                  <li>Strip the <code>--- Admin Override ---</code> entry from <strong>Notes</strong> (prior Notes content preserved)</li>
                </ul>
                <div>
                  <span style={{ color: 'var(--text-muted)' }}>Members affected ({ids.length}): </span>
                  {ids.map(id => (
                    <span key={id} style={{ display: 'inline-block', background: 'rgba(139,92,246,0.2)', border: '1px solid rgba(139,92,246,0.4)', borderRadius: 3, padding: '1px 6px', marginRight: 4, fontWeight: 600 }}>{id}</span>
                  ))}
                </div>
              </div>
            );
          })()}

          {error && <div style={{ color: '#f87171', marginBottom: 10, fontSize: 13 }}>⚠ {error}</div>}

          <button
            onClick={revertStatus}
            disabled={!selectedOverrideId || saving}
            style={{ padding: '8px 20px', borderRadius: 4, border: 'none', background: selectedOverrideId ? '#0ea5e9' : '#374151', color: selectedOverrideId ? '#fff' : '#6b7280', fontWeight: 600, cursor: selectedOverrideId ? 'pointer' : 'not-allowed' }}
          >
            {saving ? 'Reverting…' : '↩ Revert Status'}
          </button>
        </>
      )}
    </div>
  );
});
