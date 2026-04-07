/**
 * District Member Table Component
 * Renders table with member rows, checkboxes, sorting, and filtering
 */

const DistrictMemberTable = ({
  members,
  selectedMembers,
  sortBy,
  sortOrder,
  onSort,
  onSelectMember,
  onSelectAll,
  selectedColumns,
  columnFilters,
  onUpdateColumnFilter,
  onExportSelected,
  onExportAll,
  exportLoading
}) => {
  const formatDate = (dateStr, dateOnly = false) => {
    if (!dateStr) return '—';
    const date = new Date(dateStr);
    const options = {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    };
    if (!dateOnly) {
      options.hour = '2-digit';
      options.minute = '2-digit';
    }
    return date.toLocaleDateString('en-US', options);
  };

  const availableColumns = [
    { key: 'District', label: 'District' },
    { key: 'MemberID', label: 'Member ID' },
    { key: 'FirstName', label: 'First Name' },
    { key: 'LastName', label: 'Last Name' },
    { key: 'Name', label: 'Full Name' },
    { key: 'Expiration', label: 'Expiration' },
    { key: 'Gender', label: 'Gender' },
    { key: 'WeChatID', label: 'WeChat ID' },
    { key: 'Email', label: 'Email' },
    { key: 'Type', label: 'Type' },
    { key: 'FamilyID', label: 'Family ID' },
    { key: 'PaymentDate', label: 'Payment Date' },
    { key: 'MembershipFeePaid', label: 'Membership Fee Paid' },
    { key: 'PaymentTransaction', label: 'Payment Transaction' },
    { key: 'Status', label: 'Status' },
    { key: 'LastLoginDate', label: 'Last Login' },
    { key: 'LastModified', label: 'Last Modified' },
  ];

  const getColumnLabel = (key) => {
    const col = availableColumns.find(c => c.key === key);
    return col ? col.label : key;
  };

  const getCellValue = (member, key) => {
    if (key === 'Name') {
      return `${member.FirstName || ''} ${member.LastName || ''}`.trim();
    }
    const value = member[key];
    if (key === 'Expiration' || key === 'PaymentDate') {
      return formatDate(value, true);
    }
    if (key === 'LastLoginDate' || key === 'LastModified') {
      return formatDate(value, false);
    }
    return value || '—';
  };

  const getFilteredMembers = () => {
    if (Object.keys(columnFilters).length === 0) {
      return members;
    }

    return members.filter(member => {
      for (const [colKey, filterValue] of Object.entries(columnFilters)) {
        if (!filterValue) continue;

        const cellValue = getCellValue(member, colKey).toLowerCase();
        const searchValue = filterValue.toLowerCase();

        if (!cellValue.includes(searchValue)) {
          return false;
        }
      }
      return true;
    });
  };

  const filteredMembers = getFilteredMembers();

  return (
    <div
      style={{
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius)',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* Table Toolbar */}
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

      {/* Table with horizontal scroll */}
      <div
        style={{
          overflowX: 'auto',
          overflowY: 'visible',
          flex: 1,
        }}
      >
        <table
          style={{
            width: '100%',
            borderCollapse: 'collapse',
            fontSize: '13px',
            minWidth: 'min-content',
          }}
        >
          <thead>
            {/* Header Row */}
            <tr style={{ background: 'var(--surface)', borderBottom: '1px solid var(--border)' }}>
              <th
                style={{
                  padding: '12px 16px',
                  textAlign: 'left',
                  fontWeight: '600',
                  color: 'var(--text2)',
                  width: '40px',
                  minWidth: '40px',
                  position: 'sticky',
                  left: 0,
                  background: 'var(--surface)',
                  zIndex: 2,
                }}
              >
                □
              </th>
              {selectedColumns.map((colKey) => (
                <th
                  key={colKey}
                  onClick={() => onSort(colKey)}
                  style={{
                    padding: '12px 16px',
                    textAlign: 'left',
                    fontWeight: '600',
                    color: sortBy === colKey ? 'var(--accent)' : 'var(--text2)',
                    cursor: 'pointer',
                    userSelect: 'none',
                    background: sortBy === colKey ? 'rgba(var(--accent-rgb), 0.05)' : 'transparent',
                    transition: 'background 0.15s',
                    whiteSpace: 'nowrap',
                    minWidth: '120px',
                  }}
                  title="Click to sort"
                >
                  {getColumnLabel(colKey)}
                  {sortBy === colKey && (
                    <span style={{ marginLeft: '6px', fontSize: '11px' }}>
                      {sortOrder === 'asc' ? '↑' : '↓'}
                    </span>
                  )}
                </th>
              ))}
            </tr>

            {/* Filter Row */}
            <tr style={{ background: 'var(--surface)', borderBottom: '1px solid var(--border)' }}>
              <th
                style={{
                  padding: '8px 16px',
                  width: '40px',
                  minWidth: '40px',
                  position: 'sticky',
                  left: 0,
                  background: 'var(--surface)',
                  zIndex: 2,
                }}
              />
              {selectedColumns.map((colKey) => (
                <th
                  key={`filter-${colKey}`}
                  style={{
                    padding: '8px 16px',
                    minWidth: '120px',
                  }}
                >
                  <input
                    type="text"
                    placeholder={`Filter ${getColumnLabel(colKey)}`}
                    value={columnFilters[colKey] || ''}
                    onChange={(e) => onUpdateColumnFilter(colKey, e.target.value)}
                    style={{
                      width: '100%',
                      padding: '6px 8px',
                      border: '1px solid var(--border)',
                      borderRadius: '4px',
                      background: 'var(--input-bg)',
                      color: 'var(--text)',
                      fontSize: '12px',
                      boxSizing: 'border-box',
                    }}
                  />
                </th>
              ))}
            </tr>
          </thead>

          <tbody>
            {filteredMembers.map((member) => (
              <tr
                key={member.MemberID}
                style={{
                  borderBottom: '1px solid var(--border)',
                  background: selectedMembers.has(member.MemberID) ? 'rgba(var(--accent-rgb), 0.05)' : 'transparent',
                  transition: 'background 0.15s',
                }}
              >
                <td
                  style={{
                    padding: '12px 16px',
                    textAlign: 'center',
                    width: '40px',
                    minWidth: '40px',
                    position: 'sticky',
                    left: 0,
                    background: selectedMembers.has(member.MemberID)
                      ? 'rgba(var(--accent-rgb), 0.05)'
                      : 'transparent',
                    zIndex: 1,
                  }}
                >
                  <input
                    type="checkbox"
                    checked={selectedMembers.has(member.MemberID)}
                    onChange={() => onSelectMember(member.MemberID)}
                    style={{ cursor: 'pointer' }}
                  />
                </td>
                {selectedColumns.map((colKey) => (
                  <td
                    key={`${member.MemberID}-${colKey}`}
                    style={{
                      padding: '12px 16px',
                      color: colKey === 'MemberID' ? 'var(--accent)' : 'var(--text)',
                      fontSize: colKey === 'MemberID' ? '12px' : '13px',
                      fontFamily: colKey === 'MemberID' ? 'monospace' : 'inherit',
                      wordBreak: colKey === 'Email' ? 'break-all' : 'normal',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {colKey === 'Status' ? (
                      <span
                        style={{
                          display: 'inline-block',
                          padding: '3px 8px',
                          borderRadius: '4px',
                          fontSize: '11px',
                          fontWeight: '600',
                          textTransform: 'uppercase',
                          background:
                            member.Status === 'active'
                              ? 'rgba(34, 197, 94, 0.1)'
                              : member.Status === 'pending'
                                ? 'rgba(234, 179, 8, 0.1)'
                                : 'rgba(107, 114, 128, 0.1)',
                          color:
                            member.Status === 'active'
                              ? '#22c55e'
                              : member.Status === 'pending'
                                ? '#eab308'
                                : '#6b7280',
                        }}
                      >
                        {member.Status}
                      </span>
                    ) : (
                      getCellValue(member, colKey)
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Empty filtered results message */}
      {members.length > 0 && filteredMembers.length === 0 && (
        <div
          style={{
            padding: '20px',
            textAlign: 'center',
            color: 'var(--text2)',
            fontSize: '13px',
          }}
        >
          No members match the current filters
        </div>
      )}
    </div>
  );
};

window.DistrictMemberTable = DistrictMemberTable;
