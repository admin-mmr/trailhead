/**
 * District Member Filter Sections
 * Larger composed sections used by DistrictMemberFilters:
 *   - DistrictMemberSearchFilters: type/gender pills + expiration range + clear-all
 *   - DistrictMemberColumnSelector: column visibility dropdown
 * Depends on window.PillToggle (DistrictMemberFilterControls.js).
 */

const _filterLabelStyle = {
  display: 'block', fontSize: '12px', fontWeight: '600',
  marginBottom: '6px', color: 'var(--text2)', textTransform: 'uppercase',
};

const _filterDateInputStyle = {
  padding: '7px 10px',
  border: '1px solid var(--border)', borderRadius: 'var(--radius)',
  background: 'var(--input-bg)', color: 'var(--text)', fontSize: '13px',
  cursor: 'pointer', width: '140px',
};

/** Row 3: Type pills + Gender pills + Expiration range + Clear all */
const DistrictMemberSearchFilters = ({
  members,
  typeFilters,
  onTypeFiltersChange,
  genderFilters,
  onGenderFiltersChange,
  expirationFrom,
  onExpirationFromChange,
  expirationTo,
  onExpirationToChange,
  onClearAllSearchFilters,
  activeSearchFilterCount,
}) => {
  // Derive type and gender options from loaded members
  const typeOptions = React.useMemo(() => {
    const types = new Set((members || []).map(m => m.Type).filter(Boolean));
    return [...types].sort();
  }, [members]);

  const genderOptions = React.useMemo(() => {
    const genders = new Set((members || []).map(m => m.Gender).filter(Boolean));
    return [...genders].sort();
  }, [members]);

  const toggleType = (val) => {
    onTypeFiltersChange(typeFilters.includes(val)
      ? typeFilters.filter(t => t !== val)
      : [...typeFilters, val]);
  };

  const toggleGender = (val) => {
    onGenderFiltersChange(genderFilters.includes(val)
      ? genderFilters.filter(g => g !== val)
      : [...genderFilters, val]);
  };

  return (
    <div style={{
      display: 'flex', gap: '20px', marginBottom: '16px',
      alignItems: 'flex-end', flexWrap: 'wrap',
    }}>

      {/* Type pills */}
      {typeOptions.length > 0 && (
        <div>
          <label style={_filterLabelStyle}>Type</label>
          <div style={{ display: 'flex', gap: '6px' }}>
            {typeOptions.map(t => React.createElement(window.PillToggle, {
              key: t, label: t,
              active: typeFilters.includes(t),
              onClick: () => toggleType(t),
            }))}
          </div>
        </div>
      )}

      {/* Gender pills */}
      {genderOptions.length > 0 && (
        <div>
          <label style={_filterLabelStyle}>Gender</label>
          <div style={{ display: 'flex', gap: '6px' }}>
            {genderOptions.map(g => React.createElement(window.PillToggle, {
              key: g, label: g,
              active: genderFilters.includes(g),
              onClick: () => toggleGender(g),
            }))}
          </div>
        </div>
      )}

      {/* Expiration date range */}
      <div>
        <label style={_filterLabelStyle}>Expiration From</label>
        <input
          type="date"
          value={expirationFrom}
          onChange={e => onExpirationFromChange(e.target.value)}
          style={_filterDateInputStyle}
        />
      </div>

      <div>
        <label style={_filterLabelStyle}>To</label>
        <input
          type="date"
          value={expirationTo}
          onChange={e => onExpirationToChange(e.target.value)}
          style={_filterDateInputStyle}
        />
      </div>

      {/* Clear all filters */}
      {activeSearchFilterCount > 0 && (
        <div>
          <button
            onClick={onClearAllSearchFilters}
            style={{
              padding: '7px 14px',
              background: 'rgba(220, 38, 38, 0.08)',
              color: '#dc2626',
              border: '1px solid rgba(220, 38, 38, 0.3)',
              borderRadius: 'var(--radius)',
              cursor: 'pointer',
              fontSize: '13px',
              fontWeight: '500',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            <span>✕ Clear filters</span>
            <span style={{
              background: '#dc2626', color: '#fff',
              borderRadius: '999px', fontSize: '11px', fontWeight: '700',
              padding: '1px 6px',
            }}>
              {activeSearchFilterCount}
            </span>
          </button>
        </div>
      )}
    </div>
  );
};

/** Column visibility selector dropdown */
const DistrictMemberColumnSelector = ({
  hasSelection,
  selectedColumns,
  availableColumns,
  onColumnToggle,
  onResetColumns,
  showColumnSelector,
  onShowColumnSelector,
  defaultColumns,
}) => {
  if (!hasSelection) return null;
  return (
    <div style={{ marginBottom: '20px', position: 'relative' }}>
      <button
        onClick={() => onShowColumnSelector(!showColumnSelector)}
        style={{
          padding: '8px 16px', background: 'transparent',
          color: 'var(--accent)', border: '1px solid var(--accent)',
          borderRadius: 'var(--radius)', cursor: 'pointer',
          fontSize: '13px', fontWeight: '500',
        }}
      >
        ⚙ Columns ({selectedColumns.length})
      </button>

      {showColumnSelector && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, marginTop: '8px',
          background: 'var(--surface)', border: '1px solid var(--border)',
          borderRadius: 'var(--radius)', padding: '12px',
          minWidth: 'min(300px, calc(100vw - 24px))', maxWidth: 'calc(100vw - 24px)',
          maxHeight: '400px', overflowY: 'auto', zIndex: 1000,
          boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)',
        }}>
          <div style={{ marginBottom: '12px' }}>
            <button
              onClick={() => onResetColumns(defaultColumns)}
              style={{
                padding: '4px 8px', fontSize: '11px', background: 'transparent',
                color: 'var(--text2)', border: '1px solid var(--border)',
                borderRadius: '4px', cursor: 'pointer',
              }}
            >
              Reset to Default
            </button>
          </div>
          {availableColumns.map((col) => (
            <label key={col.key} style={{
              display: 'flex', alignItems: 'center',
              padding: '6px 0', cursor: 'pointer', fontSize: '13px',
            }}>
              <input
                type="checkbox"
                checked={selectedColumns.includes(col.key)}
                onChange={() => onColumnToggle(col.key)}
                style={{ marginRight: '8px', cursor: 'pointer' }}
              />
              {col.label}
            </label>
          ))}
        </div>
      )}
    </div>
  );
};

window.DistrictMemberSearchFilters = DistrictMemberSearchFilters;
window.DistrictMemberColumnSelector = DistrictMemberColumnSelector;
