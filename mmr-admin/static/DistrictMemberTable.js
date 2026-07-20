/**
 * District Member Table Component
 * Renders table with member rows, checkboxes, sorting, and filtering.
 * Sub-components: window.DistrictMemberTableToolbar (DistrictMemberTableToolbar.js),
 *   window.DistrictMemberTableRow (DistrictMemberTableRow.js).
 * Helpers: window.DistrictTableHelpers (DistrictMemberTableHelpers.js).
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
  exportLoading,
  globalSearch,
}) => {
  const { getColumnLabel, getCellValue } = window.DistrictTableHelpers;
  const tableRef = React.useRef(null);
  const topScrollRef = React.useRef(null);
  const [tableScrollWidth, setTableScrollWidth] = React.useState(0);

  // Sync scroll positions between top scrollbar and table
  const onTopScroll = () => {
    if (tableRef.current && topScrollRef.current) {
      tableRef.current.scrollLeft = topScrollRef.current.scrollLeft;
    }
  };
  const onTableScroll = () => {
    if (tableRef.current && topScrollRef.current) {
      topScrollRef.current.scrollLeft = tableRef.current.scrollLeft;
    }
  };

  // Update dummy width when columns change
  React.useEffect(() => {
    if (tableRef.current) {
      setTableScrollWidth(tableRef.current.scrollWidth);
    }
  }, [selectedColumns, members]);

  const dummyWidth = tableScrollWidth || 2000;

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
      {React.createElement(window.DistrictMemberTableToolbar, {
        selectedMembers,
        filteredMembers,
        onSelectAll,
        onExportSelected,
        onExportAll,
        exportLoading,
      })}

      {/* Top scrollbar (synchronized with table) */}
      <div
        ref={topScrollRef}
        onScroll={onTopScroll}
        style={{ overflowX: 'auto', overflowY: 'hidden', height: '14px' }}
      >
        <div style={{ width: `${dummyWidth}px`, height: '1px' }} />
      </div>

      {/* Table with horizontal scroll */}
      <div
        ref={tableRef}
        onScroll={onTableScroll}
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
            {filteredMembers.map((member) => React.createElement(window.DistrictMemberTableRow, {
              key: member.MemberID,
              member,
              selectedColumns,
              isSelected: selectedMembers.has(member.MemberID),
              onSelectMember,
              globalSearch,
            }))}
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
