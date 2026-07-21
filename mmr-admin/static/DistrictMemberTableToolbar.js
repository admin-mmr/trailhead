/**
 * District Member Table Toolbar
 * Select-all checkbox + selection count + export buttons.
 * Consumed by DistrictMemberTable (window.DistrictMemberTableToolbar).
 */

const DistrictMemberTableToolbar = ({
  selectedMembers,
  filteredMembers,
  onSelectAll,
  onExportSelected,
  onExportAll,
  exportLoading,
}) => (
  <div
    style={{
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      padding: '16px',
      background: 'var(--surface)',
      borderBottom: '1px solid var(--border)',
    }}
  >
    <div style={{ fontSize: '13px', color: 'var(--text2)' }}>
      <input
        type="checkbox"
        checked={selectedMembers.size === filteredMembers.length && filteredMembers.length > 0}
        onChange={onSelectAll}
        style={{ marginRight: '8px', cursor: 'pointer' }}
      />
      {selectedMembers.size} of {filteredMembers.length} visible selected
    </div>

    <div style={{ display: 'flex', gap: '8px' }}>
      <button
        onClick={onExportSelected}
        disabled={selectedMembers.size === 0 || exportLoading}
        style={{
          padding: '8px 16px',
          background: selectedMembers.size > 0 ? 'var(--accent)' : 'var(--surface)',
          color: selectedMembers.size > 0 ? '#fff' : 'var(--text2)',
          border: `1px solid ${selectedMembers.size > 0 ? 'var(--accent)' : 'var(--border)'}`,
          borderRadius: 'var(--radius)',
          cursor: selectedMembers.size > 0 ? 'pointer' : 'not-allowed',
          fontSize: '13px',
          fontWeight: '500',
        }}
      >
        {exportLoading ? 'Exporting...' : '↓ Export Selected'}
      </button>

      <button
        onClick={onExportAll}
        disabled={exportLoading}
        style={{
          padding: '8px 16px',
          background: 'transparent',
          color: 'var(--accent)',
          border: '1px solid var(--accent)',
          borderRadius: 'var(--radius)',
          cursor: exportLoading ? 'not-allowed' : 'pointer',
          fontSize: '13px',
          fontWeight: '500',
        }}
      >
        {exportLoading ? 'Exporting...' : '↓ Export All in District'}
      </button>
    </div>
  </div>
);

window.DistrictMemberTableToolbar = DistrictMemberTableToolbar;
