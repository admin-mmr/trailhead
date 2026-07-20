/**
 * District Member Filter Controls
 * Shared low-level controls used by DistrictMemberFilters:
 *   - MultiSelectDropdown: checkbox multi-select dropdown
 *   - PillToggle: compact pill toggle button
 */

/** Reusable multi-select dropdown with checkboxes */
const MultiSelectDropdown = ({ label, options, selected, showAll, onToggleAll, onToggleOption }) => {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef(null);

  React.useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const displayText = showAll || selected.length === 0
    ? `All ${label}s`
    : selected.length === 1
      ? selected[0]
      : `${selected.length} selected`;

  return (
    <div ref={ref} style={{ minWidth: '180px', position: 'relative' }}>
      <label style={{
        display: 'block', fontSize: '12px', fontWeight: '600',
        marginBottom: '6px', color: 'var(--text2)', textTransform: 'uppercase',
      }}>
        {label}
      </label>
      <button
        onClick={() => setOpen(!open)}
        style={{
          width: '100%', padding: '8px 12px',
          border: '1px solid var(--border)', borderRadius: 'var(--radius)',
          background: 'var(--input-bg)', color: 'var(--text)', fontSize: '14px',
          cursor: 'pointer', textAlign: 'left',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        }}
      >
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{displayText}</span>
        <span style={{ fontSize: '10px', marginLeft: '8px', flexShrink: 0 }}>{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, marginTop: '4px',
          background: 'var(--surface)', border: '1px solid var(--border)',
          borderRadius: 'var(--radius)', padding: '6px 0', minWidth: '100%',
          maxHeight: '280px', overflowY: 'auto', zIndex: 1000,
          boxShadow: '0 4px 16px rgba(0,0,0,0.2)',
        }}>
          <label style={{
            display: 'flex', alignItems: 'center', padding: '7px 12px',
            cursor: 'pointer', borderBottom: '1px solid var(--border)',
            marginBottom: '4px', fontSize: '13px', fontWeight: '600',
          }}>
            <input
              type="checkbox"
              checked={showAll || selected.length === 0}
              onChange={onToggleAll}
              style={{ marginRight: '8px', cursor: 'pointer' }}
            />
            All
          </label>
          {options.map((opt) => {
            const val = opt.value !== undefined ? opt.value : opt;
            const lbl = opt.label || opt;
            if (!val) return null;
            return (
              <label key={val} style={{
                display: 'flex', alignItems: 'center', padding: '6px 12px',
                cursor: 'pointer', fontSize: '13px',
              }}>
                <input
                  type="checkbox"
                  checked={selected.includes(val)}
                  onChange={() => onToggleOption(val)}
                  style={{ marginRight: '8px', cursor: 'pointer' }}
                />
                {lbl}
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
};

/** Compact pill toggle button */
const PillToggle = ({ label, active, onClick }) => (
  <button
    onClick={onClick}
    style={{
      padding: '5px 12px',
      borderRadius: '999px',
      border: active ? '1px solid var(--accent)' : '1px solid var(--border)',
      background: active ? 'var(--accent)' : 'transparent',
      color: active ? '#fff' : 'var(--text2)',
      fontSize: '12px',
      fontWeight: active ? '600' : '400',
      cursor: 'pointer',
      transition: 'all 0.15s',
      whiteSpace: 'nowrap',
    }}
  >
    {label}
  </button>
);

window.MultiSelectDropdown = MultiSelectDropdown;
window.PillToggle = PillToggle;
