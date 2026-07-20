/**
 * AuditPanelParts — sub-components for the Membership Renewal Audit panel.
 *
 * Extracted from AuditPanel.js to keep each file under the 300-line
 * code-health limit.
 *
 * AuditMemberLookup: self-contained member search card (own state + debounce).
 *   Uses mmrUtils.api. Rendered as window.AuditMemberLookup.
 */

window.AuditMemberLookup = () => {
  const [memberSearch, setMemberSearch] = React.useState('');
  const [memberSearchResults, setMemberSearchResults] = React.useState([]);
  const [memberSearchLoading, setMemberSearchLoading] = React.useState(false);
  const memberSearchTimer = React.useRef(null);

  React.useEffect(() => {
    if (memberSearchTimer.current) clearTimeout(memberSearchTimer.current);
    if (!memberSearch.trim()) {
      setMemberSearchResults([]);
      return;
    }
    memberSearchTimer.current = setTimeout(async () => {
      setMemberSearchLoading(true);
      try {
        const resp = await mmrUtils.api(`/api/members/search?q=${encodeURIComponent(memberSearch.trim())}`);
        setMemberSearchResults(resp.ok ? resp.data : []);
      } catch {
        setMemberSearchResults([]);
      } finally {
        setMemberSearchLoading(false);
      }
    }, 300);
  }, [memberSearch]);

  const expirationColor = (dateStr) => {
    if (!dateStr) return '#94a3b8';
    const exp = new Date(dateStr);
    const now = new Date();
    const days = (exp - now) / (1000 * 60 * 60 * 24);
    if (days < 0) return '#f87171';
    if (days < 60) return '#fb923c';
    return '#4ade80';
  };

  const inputBase = { width: '100%', padding: '8px', border: '1px solid var(--border)', borderRadius: '4px', fontSize: '14px', backgroundColor: 'var(--surface2)', color: 'var(--text)' };
  const card = { backgroundColor: 'var(--surface)', padding: '12px', borderRadius: '6px', border: '1px solid var(--border)' };

  return (
    <div style={{ ...card, marginBottom: '20px' }}>
      <div style={{ fontSize: '13px', fontWeight: '600', color: 'var(--text2)', marginBottom: '10px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
        🔎 Member Lookup
      </div>
      <input
        type="text"
        placeholder="Search by name, email, or member ID…"
        value={memberSearch}
        onChange={e => setMemberSearch(e.target.value)}
        style={{ ...inputBase, marginBottom: '10px' }}
      />
      {memberSearchLoading && (
        <div style={{ color: 'var(--text2)', fontSize: '13px' }}>Searching…</div>
      )}
      {!memberSearchLoading && memberSearch && memberSearchResults.length === 0 && (
        <div style={{ color: 'var(--text2)', fontSize: '13px' }}>No members found.</div>
      )}
      {memberSearchResults.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '8px' }}>
          {memberSearchResults.map(m => (
            <div key={m.MemberID} style={{
              backgroundColor: 'var(--surface2)',
              borderRadius: '6px',
              padding: '10px 12px',
              border: `1px solid var(--border)`,
              display: 'flex',
              flexDirection: 'column',
              gap: '4px'
            }}>
              <div style={{ fontWeight: '600', fontSize: '14px', color: 'var(--text)' }}>
                {m.FirstName} {m.LastName}
              </div>
              <div style={{ fontSize: '12px', color: 'var(--text2)' }}>
                {m.MemberID} · {m.Type || '—'}
                {m.FamilyID && <span style={{ marginLeft: '6px', color: 'var(--accent)' }}>Family</span>}
              </div>
              <div style={{ fontSize: '12px', color: 'var(--text2)' }}>{m.Email || ''}</div>
              <div style={{ marginTop: '4px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span style={{ fontSize: '11px', color: 'var(--text2)' }}>Expires:</span>
                <span style={{
                  fontSize: '12px',
                  fontWeight: '600',
                  color: expirationColor(m.Expiration),
                  backgroundColor: 'rgba(0,0,0,0.2)',
                  padding: '1px 7px',
                  borderRadius: '4px'
                }}>
                  {m.Expiration || 'Not set'}
                </span>
                {m.Status && (
                  <span style={{ fontSize: '11px', color: 'var(--text2)', marginLeft: '4px' }}>{m.Status}</span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
