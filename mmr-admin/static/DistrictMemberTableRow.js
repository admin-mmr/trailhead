/**
 * District Member Table Row
 * Renders a single member <tr> (sticky checkbox cell + data cells with
 * status badge + global-search highlighting).
 * Depends on window.DistrictTableHelpers (DistrictMemberTableHelpers.js).
 * Consumed by DistrictMemberTable (window.DistrictMemberTableRow).
 */

const DistrictMemberTableRow = ({
  member,
  selectedColumns,
  isSelected,
  onSelectMember,
  globalSearch,
}) => {
  const { getCellValue, highlightMatch } = window.DistrictTableHelpers;
  return (
    <tr
      style={{
        borderBottom: '1px solid var(--border)',
        background: isSelected ? 'rgba(var(--accent-rgb), 0.05)' : 'transparent',
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
          background: isSelected
            ? 'rgba(var(--accent-rgb), 0.05)'
            : 'transparent',
          zIndex: 1,
        }}
      >
        <input
          type="checkbox"
          checked={isSelected}
          onChange={() => onSelectMember(member.MemberID)}
          style={{ cursor: 'pointer' }}
        />
      </td>
      {selectedColumns.map((colKey) => {
        const rawValue = getCellValue(member, colKey);
        // Columns where we apply global-search highlighting
        const highlightCols = new Set(['MemberID', 'Name', 'FirstName', 'LastName', 'Email', 'WeChatID', 'District']);
        const shouldHighlight = globalSearch && highlightCols.has(colKey);
        return (
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
            ) : shouldHighlight ? (
              highlightMatch(rawValue, globalSearch)
            ) : (
              rawValue
            )}
          </td>
        );
      })}
    </tr>
  );
};

window.DistrictMemberTableRow = DistrictMemberTableRow;
