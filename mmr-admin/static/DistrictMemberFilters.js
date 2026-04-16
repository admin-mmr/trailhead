/**
 * District Member Filters Component
 * Multi-select district + status dropdowns, column visibility, export buttons
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
            if (!val) return null; // skip empty-value "All Statuses" option
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
      {/* Filters Row */}
      <div style={{
        display: 'flex', gap: '16px', marginBottom: '20px',
        alignItems: 'flex-end', flexWrap: 'wrap',
      }}>
        {React.createElement(MultiSelectDropdown, {
          label: 'District',
          options: districts,
          selected: selectedDistricts,
          showAll: showAllDistricts,
          onToggleAll: handleToggleAllDistricts,
          onToggleOption: handleToggleDistrict,
        })}

        {React.createElement(MultiSelectDropdown, {
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

      {/* Column Selector */}
      {hasSelection && (
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
              borderRadius: 'var(--radius)', padding: '12px', minWidth: '300px',
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
      )}
    </>
  );
};

window.DistrictMemberFilters = DistrictMemberFilters;
