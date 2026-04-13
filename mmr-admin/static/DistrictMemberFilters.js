/**
 * District Member Filters Component
 * District selector, status filter, renewal filter, column visibility, export buttons
 */

const DistrictMemberFilters = ({
  districts,
  statusOptions,
  selectedDistrict,
  statusFilter,
  renewedFilter,
  onDistrictChange,
  onStatusChange,
  onRenewalChange,
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
  return (
    <>
      {/* Filters Row */}
      <div
        style={{
          display: 'flex',
          gap: '16px',
          marginBottom: '20px',
          alignItems: 'flex-end',
          flexWrap: 'wrap',
        }}
      >
        <div style={{ minWidth: '180px' }}>
          <label
            style={{
              display: 'block',
              fontSize: '12px',
              fontWeight: '600',
              marginBottom: '6px',
              color: 'var(--text2)',
              textTransform: 'uppercase',
            }}
          >
            District *
          </label>
          <select
            value={selectedDistrict}
            onChange={(e) => onDistrictChange(e.target.value)}
            style={{
              width: '100%',
              padding: '8px 12px',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius)',
              background: 'var(--input-bg)',
              color: 'var(--text)',
              fontSize: '14px',
              cursor: 'pointer',
            }}
          >
            <option value="">-- Select District --</option>
            {districts.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </div>

        <div style={{ minWidth: '180px' }}>
          <label
            style={{
              display: 'block',
              fontSize: '12px',
              fontWeight: '600',
              marginBottom: '6px',
              color: 'var(--text2)',
              textTransform: 'uppercase',
            }}
          >
            Membership Status
          </label>
          <select
            value={statusFilter}
            onChange={(e) => onStatusChange(e.target.value)}
            style={{
              width: '100%',
              padding: '8px 12px',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius)',
              background: 'var(--input-bg)',
              color: 'var(--text)',
              fontSize: '14px',
              cursor: 'pointer',
            }}
          >
            {(statusOptions && statusOptions.length > 0
              ? statusOptions
              : [
                  { value: '', label: 'All Statuses' },
                  { value: 'active', label: 'Active' },
                  { value: 'not_active', label: 'Not Active' },
                  { value: 'pending', label: 'Pending' },
                  { value: 'lifetime', label: 'Lifetime' },
                ]
            ).map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>

        <div style={{ minWidth: '180px' }}>
          <label
            style={{
              display: 'block',
              fontSize: '12px',
              fontWeight: '600',
              marginBottom: '6px',
              color: 'var(--text2)',
              textTransform: 'uppercase',
            }}
          >
            Renewal Status
          </label>
          <select
            value={renewedFilter}
            onChange={(e) => onRenewalChange(e.target.value)}
            style={{
              width: '100%',
              padding: '8px 12px',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius)',
              background: 'var(--input-bg)',
              color: 'var(--text)',
              fontSize: '14px',
              cursor: 'pointer',
            }}
          >
            <option value="">All</option>
            <option value="yes">Renewed</option>
            <option value="no">Not Renewed</option>
          </select>
        </div>

        <div style={{ display: 'flex', gap: '8px', flex: 1, minWidth: '200px' }}>
          {selectedDistrict && (
            <button
              onClick={onRefresh}
              disabled={loading}
              style={{
                padding: '8px 16px',
                background: 'var(--accent)',
                color: '#fff',
                border: 'none',
                borderRadius: 'var(--radius)',
                cursor: loading ? 'not-allowed' : 'pointer',
                fontSize: '14px',
                fontWeight: '500',
                opacity: loading ? 0.6 : 1,
              }}
            >
              {loading ? 'Loading...' : 'Refresh'}
            </button>
          )}

          <button
            onClick={onExportAllDistricts}
            disabled={exportLoading}
            style={{
              padding: '8px 16px',
              background: 'var(--green)',
              color: '#0f172a',
              border: 'none',
              borderRadius: 'var(--radius)',
              cursor: exportLoading ? 'not-allowed' : 'pointer',
              fontSize: '14px',
              fontWeight: '500',
              opacity: exportLoading ? 0.6 : 1,
            }}
          >
            {exportLoading ? 'Exporting...' : '⬇ Export All Districts (ZIP)'}
          </button>

          <button
            onClick={onExportAllAsSheet}
            disabled={exportLoading}
            style={{
              padding: '8px 16px',
              background: 'var(--accent)',
              color: '#fff',
              border: 'none',
              borderRadius: 'var(--radius)',
              cursor: exportLoading ? 'not-allowed' : 'pointer',
              fontSize: '14px',
              fontWeight: '500',
              opacity: exportLoading ? 0.6 : 1,
            }}
          >
            {exportLoading ? 'Exporting...' : '⬇ Export All (Single Sheet)'}
          </button>
        </div>
      </div>

      {/* Column Selector */}
      {selectedDistrict && (
        <div style={{ marginBottom: '20px', position: 'relative' }}>
          <button
            onClick={() => onShowColumnSelector(!showColumnSelector)}
            style={{
              padding: '8px 16px',
              background: 'transparent',
              color: 'var(--accent)',
              border: '1px solid var(--accent)',
              borderRadius: 'var(--radius)',
              cursor: 'pointer',
              fontSize: '13px',
              fontWeight: '500',
            }}
          >
            ⚙ Columns ({selectedColumns.length})
          </button>

          {showColumnSelector && (
            <div
              style={{
                position: 'absolute',
                top: '100%',
                left: 0,
                marginTop: '8px',
                background: 'var(--surface)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius)',
                padding: '12px',
                minWidth: '300px',
                maxHeight: '400px',
                overflowY: 'auto',
                zIndex: 1000,
                boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)',
              }}
            >
              <div style={{ marginBottom: '12px' }}>
                <button
                  onClick={() => onResetColumns(defaultColumns)}
                  style={{
                    padding: '4px 8px',
                    fontSize: '11px',
                    background: 'transparent',
                    color: 'var(--text2)',
                    border: '1px solid var(--border)',
                    borderRadius: '4px',
                    cursor: 'pointer',
                  }}
                >
                  Reset to Default
                </button>
              </div>
              {availableColumns.map((col) => (
                <label
                  key={col.key}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    padding: '6px 0',
                    cursor: 'pointer',
                    fontSize: '13px',
                  }}
                >
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
