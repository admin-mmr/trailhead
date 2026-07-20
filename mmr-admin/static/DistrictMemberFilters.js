/**
 * District Member Filters Component
 * Multi-select district + status dropdowns, global search, type/gender pills,
 * expiration date range, column visibility, and export buttons.
 * Sub-components: window.MultiSelectDropdown / window.PillToggle
 *   (DistrictMemberFilterControls.js), window.DistrictMemberSearchFilters /
 *   window.DistrictMemberColumnSelector (DistrictMemberFilterSections.js).
 */

const DistrictMemberFilters = ({
  districts,
  statusOptions,
  selectedDistricts,
  showAllDistricts,
  statusFilters,
  onDistrictChange,
  onStatusChange,
  loading,
  onRefresh,
  onExportAllDistricts,
  onExportAllAsSheet,
  exportLoading,
  selectedColumns,
  availableColumns,
  onColumnToggle,
  onResetColumns,
  showColumnSelector,
  onShowColumnSelector,
  defaultColumns,
  // Search & filter props
  globalSearch,
  onGlobalSearch,
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
  members,
}) => {
  const handleToggleAllDistricts = () => {
    onDistrictChange([], true);
  };

  const handleToggleDistrict = (val) => {
    const isSelected = selectedDistricts.includes(val);
    const newSelected = isSelected
      ? selectedDistricts.filter(d => d !== val)
      : [...selectedDistricts, val];
    onDistrictChange(newSelected, false);
  };

  const handleToggleAllStatuses = () => {
    onStatusChange([]);
  };

  const handleToggleStatus = (val) => {
    const isSelected = statusFilters.includes(val);
    onStatusChange(isSelected ? statusFilters.filter(s => s !== val) : [...statusFilters, val]);
  };

  const statusOpts = statusOptions && statusOptions.length > 0
    ? statusOptions.filter(o => o.value !== '')
    : [
        { value: 'active', label: 'active' },
        { value: 'expired', label: 'expired' },
        { value: 'inactive', label: 'inactive' },
        { value: 'lifetime', label: 'lifetime' },
        { value: 'pending', label: 'pending' },
        { value: 'pending_upgrade', label: 'pending_upgrade' },
      ];

  const hasSelection = selectedDistricts.length > 0 || showAllDistricts;

  return (
    <>
      {/* ── Row 1: District + Status dropdowns + action buttons ── */}
      <div style={{
        display: 'flex', gap: '16px', marginBottom: '16px',
        alignItems: 'flex-end', flexWrap: 'wrap',
      }}>
        {React.createElement(window.MultiSelectDropdown, {
          label: 'District',
          options: districts,
          selected: selectedDistricts,
          showAll: showAllDistricts,
          onToggleAll: handleToggleAllDistricts,
          onToggleOption: handleToggleDistrict,
        })}

        {React.createElement(window.MultiSelectDropdown, {
          label: 'Status',
          options: statusOpts,
          selected: statusFilters,
          showAll: statusFilters.length === 0,
          onToggleAll: handleToggleAllStatuses,
          onToggleOption: handleToggleStatus,
        })}

        <div style={{ display: 'flex', gap: '8px', flex: 1, minWidth: '200px', flexWrap: 'wrap' }}>
          {hasSelection && (
            <button
              onClick={onRefresh}
              disabled={loading}
              style={{
                padding: '8px 16px', background: 'var(--accent)', color: '#fff',
                border: 'none', borderRadius: 'var(--radius)',
                cursor: loading ? 'not-allowed' : 'pointer',
                fontSize: '14px', fontWeight: '500', opacity: loading ? 0.6 : 1,
              }}
            >
              {loading ? 'Loading...' : 'Refresh'}
            </button>
          )}

          <button
            onClick={onExportAllDistricts}
            disabled={exportLoading}
            style={{
              padding: '8px 16px', background: 'var(--green)', color: '#0f172a',
              border: 'none', borderRadius: 'var(--radius)',
              cursor: exportLoading ? 'not-allowed' : 'pointer',
              fontSize: '14px', fontWeight: '500', opacity: exportLoading ? 0.6 : 1,
            }}
          >
            {exportLoading ? 'Exporting...' : '⬇ Export All Districts (ZIP)'}
          </button>

          <button
            onClick={onExportAllAsSheet}
            disabled={exportLoading}
            style={{
              padding: '8px 16px', background: 'var(--accent)', color: '#fff',
              border: 'none', borderRadius: 'var(--radius)',
              cursor: exportLoading ? 'not-allowed' : 'pointer',
              fontSize: '14px', fontWeight: '500', opacity: exportLoading ? 0.6 : 1,
            }}
          >
            {exportLoading ? 'Exporting...' : '⬇ Export All (Single Sheet)'}
          </button>
        </div>
      </div>

      {/* ── Row 2: Global search bar ── */}
      <div style={{ marginBottom: '14px', position: 'relative' }}>
        <div style={{ position: 'relative' }}>
          <span style={{
            position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)',
            color: 'var(--text2)', fontSize: '15px', pointerEvents: 'none',
          }}>
            🔍
          </span>
          <input
            type="text"
            placeholder="Search by name, email, member ID, WeChat, district…"
            value={globalSearch}
            onChange={e => onGlobalSearch(e.target.value)}
            style={{
              width: '100%',
              padding: '9px 12px 9px 36px',
              border: globalSearch ? '1px solid var(--accent)' : '1px solid var(--border)',
              borderRadius: 'var(--radius)',
              background: 'var(--input-bg)',
              color: 'var(--text)',
              fontSize: '14px',
              boxSizing: 'border-box',
              outline: 'none',
              transition: 'border-color 0.15s',
            }}
          />
          {globalSearch && (
            <button
              onClick={() => onGlobalSearch('')}
              style={{
                position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)',
                background: 'none', border: 'none', cursor: 'pointer',
                color: 'var(--text2)', fontSize: '16px', padding: '2px 4px',
              }}
              title="Clear search"
            >
              ×
            </button>
          )}
        </div>
      </div>

      {/* ── Row 3: Type pills + Gender pills + Expiration range + Clear all ── */}
      {window.DistrictMemberSearchFilters && React.createElement(window.DistrictMemberSearchFilters, {
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
      })}

      {/* ── Column Selector ── */}
      {window.DistrictMemberColumnSelector && React.createElement(window.DistrictMemberColumnSelector, {
        hasSelection,
        selectedColumns,
        availableColumns,
        onColumnToggle,
        onResetColumns,
        showColumnSelector,
        onShowColumnSelector,
        defaultColumns,
      })}
    </>
  );
};

window.DistrictMemberFilters = DistrictMemberFilters;
