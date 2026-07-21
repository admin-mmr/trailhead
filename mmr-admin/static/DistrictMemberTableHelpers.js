/**
 * District Member Table Helpers
 * Shared pure helpers + column metadata used by DistrictMemberTable and
 * DistrictMemberTableRow. Exposed as window.DistrictTableHelpers.
 */

// Highlight matching text within a string. Returns a React element or plain string.
const highlightMatch = (text, query) => {
  if (!query || !text || text === '—') return text;
  const str = String(text);
  const idx = str.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return str;
  return React.createElement(React.Fragment, null,
    str.substring(0, idx),
    React.createElement('mark', {
      style: {
        background: 'rgba(255, 193, 7, 0.45)',
        borderRadius: '2px',
        padding: '0 1px',
        color: 'inherit',
      }
    }, str.substring(idx, idx + query.length)),
    str.substring(idx + query.length)
  );
};

const formatDate = (dateStr, dateOnly = false) => {
  if (!dateStr) return '—';
  // Append T00:00:00 to date-only strings so JS parses as local time, not UTC midnight
  const normalized = dateOnly && /^\d{4}-\d{2}-\d{2}$/.test(dateStr)
    ? dateStr + 'T00:00:00'
    : dateStr;
  const date = new Date(normalized);
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
  if (key === 'LastModified') {
    return formatDate(value, false);
  }
  return value || '—';
};

window.DistrictTableHelpers = {
  highlightMatch,
  formatDate,
  availableColumns,
  getColumnLabel,
  getCellValue,
};
