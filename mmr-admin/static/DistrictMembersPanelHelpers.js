/**
 * District Members Panel Helpers
 * Column config + pure formatting/filtering helpers for DistrictMembersPanel.
 * Exposed as window.DistrictPanelHelpers.
 */

const _panelAvailableColumns = [
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

const _panelDefaultColumns = [
  'District', 'MemberID', 'Name', 'Status', 'Expiration', 'Gender',
  'WeChatID', 'Email', 'Type', 'FamilyID', 'PaymentDate',
  'MembershipFeePaid', 'PaymentTransaction'
];

const _panelFormatDate = (dateStr, dateOnly = false) => {
  if (!dateStr) return '—';
  const normalized = /^\d{4}-\d{2}-\d{2}$/.test(dateStr) ? dateStr + 'T00:00:00' : dateStr;
  const date = new Date(normalized);
  const options = { year: 'numeric', month: 'short', day: 'numeric' };
  if (!dateOnly) {
    options.hour = '2-digit';
    options.minute = '2-digit';
  }
  return date.toLocaleDateString('en-US', options);
};

const _panelGetCellValue = (member, key) => {
  if (key === 'Name') {
    return `${member.FirstName || ''} ${member.LastName || ''}`.trim();
  }
  const value = member[key];
  if (key === 'Expiration' || key === 'PaymentDate') {
    return _panelFormatDate(value, true);
  }
  if (key === 'LastModified') {
    return _panelFormatDate(value, false);
  }
  return value || '—';
};

// Client-side search predicate: global search + type/gender + expiration range.
const _panelMemberMatchesSearch = (member, filters) => {
  const { globalSearch, typeFilters, genderFilters, expirationFrom, expirationTo } = filters;
  // Global search: name, email, memberID, wechat, district
  if (globalSearch) {
    const q = globalSearch.toLowerCase();
    const fullName = `${member.FirstName || ''} ${member.LastName || ''}`.toLowerCase();
    const searchable = [
      fullName,
      (member.FirstName || '').toLowerCase(),
      (member.LastName || '').toLowerCase(),
      (member.Email || '').toLowerCase(),
      (member.MemberID || '').toLowerCase(),
      (member.WeChatID || '').toLowerCase(),
      (member.District || '').toLowerCase(),
    ];
    if (!searchable.some(v => v.includes(q))) return false;
  }
  // Type filter
  if (typeFilters.length > 0 && !typeFilters.includes(member.Type)) return false;
  // Gender filter
  if (genderFilters.length > 0 && !genderFilters.includes(member.Gender)) return false;
  // Expiration date range (compare raw YYYY-MM-DD strings)
  if (expirationFrom || expirationTo) {
    const raw = member.Expiration ? String(member.Expiration).substring(0, 10) : null;
    if (!raw) return false; // no expiration date — exclude when range is active
    if (expirationFrom && raw < expirationFrom) return false;
    if (expirationTo && raw > expirationTo) return false;
  }
  return true;
};

window.DistrictPanelHelpers = {
  availableColumns: _panelAvailableColumns,
  defaultColumns: _panelDefaultColumns,
  formatDate: _panelFormatDate,
  getCellValue: _panelGetCellValue,
  memberMatchesSearch: _panelMemberMatchesSearch,
};
