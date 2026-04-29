/**
 * District Members Panel (Core)
 * State management and data fetching for district member browsing
 * Sub-components: DistrictMemberFilters, DistrictMemberTable
 */

window.DistrictMembersPanel = () => {
  const [districts, setDistricts] = React.useState([]);
  const [statusOptions, setStatusOptions] = React.useState([]);
  const [selectedDistricts, setSelectedDistricts] = React.useState([]);
  const [showAllDistricts, setShowAllDistricts] = React.useState(false);
  const [members, setMembers] = React.useState([]);
  const [selectedMembers, setSelectedMembers] = React.useState(new Set());
  const [loading, setLoading] = React.useState(false);
  const [statusFilters, setStatusFilters] = React.useState([]);
  const [error, setError] = React.useState('');
  const [exportLoading, setExportLoading] = React.useState(false);
  const [sortBy, setSortBy] = React.useState('District');
  const [sortOrder, setSortOrder] = React.useState('asc');
  const [showColumnSelector, setShowColumnSelector] = React.useState(false);
  const [columnFilters, setColumnFilters] = React.useState({});

  // --- Search & filter state (client-side, applied on top of API results) ---
  const [globalSearch, setGlobalSearch] = React.useState('');
  const [typeFilters, setTypeFilters] = React.useState([]);
  const [genderFilters, setGenderFilters] = React.useState([]);
  const [expirationFrom, setExpirationFrom] = React.useState('');
  const [expirationTo, setExpirationTo] = React.useState('');

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

  const defaultColumns = [
    'District', 'MemberID', 'Name', 'Status', 'Expiration', 'Gender',
    'WeChatID', 'Email', 'Type', 'FamilyID', 'PaymentDate',
    'MembershipFeePaid', 'PaymentTransaction'
  ];

  const [selectedColumns, setSelectedColumns] = React.useState(() => {
    try {
      const saved = localStorage.getItem('mmr_selected_columns');
      return saved ? JSON.parse(saved) : defaultColumns;
    } catch {
      return defaultColumns;
    }
  });

  React.useEffect(() => {
    try {
      localStorage.setItem('mmr_selected_columns', JSON.stringify(selectedColumns));
    } catch {}
  }, [selectedColumns]);

  React.useEffect(() => {
    try {
      const saved = localStorage.getItem('mmr_sort_preferences');
      if (saved) {
        const prefs = JSON.parse(saved);
        const legacyKeys = new Set(['LastLoginDate', 'LastLogin']);
        const resolvedSortBy = legacyKeys.has(prefs.sortBy) ? 'District' : (prefs.sortBy || 'District');
        setSortBy(resolvedSortBy);
        setSortOrder(prefs.sortOrder || 'asc');
      }
    } catch {}
  }, []);

  const updateSort = (newSortBy, newSortOrder) => {
    setSortBy(newSortBy);
    setSortOrder(newSortOrder);
    try {
      localStorage.setItem('mmr_sort_preferences', JSON.stringify({
        sortBy: newSortBy,
        sortOrder: newSortOrder
      }));
    } catch {}
  };

  React.useEffect(() => {
    fetchDistricts();
    fetchStatusOptions();
  }, []);

  React.useEffect(() => {
    if (selectedDistricts.length > 0 || showAllDistricts) {
      fetchMembers();
    } else {
      setMembers([]);
      setSelectedMembers(new Set());
    }
  }, [selectedDistricts, showAllDistricts, statusFilters, sortBy, sortOrder]);

  const fetchDistricts = async () => {
    const { api } = window.mmrUtils;
    try {
      const data = await api('/api/district/districts');
      if (data.success) {
        setDistricts(data.districts);
        setError('');
      } else {
        setError(data.error || 'Failed to fetch districts');
      }
    } catch (err) {
      setError(`Error: ${err.message}`);
    }
  };

  const fetchStatusOptions = async () => {
    const { api } = window.mmrUtils;
    try {
      const data = await api('/api/district/member-status-values');
      if (data.success) setStatusOptions(data.options);
    } catch (_) {}
  };

  const fetchMembers = async () => {
    const { api } = window.mmrUtils;
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      if (!showAllDistricts && selectedDistricts.length > 0) {
        params.append('district', selectedDistricts.join(','));
      }
      if (statusFilters.length > 0) params.append('status', statusFilters.join(','));
      params.append('sortBy', sortBy);
      params.append('sortOrder', sortOrder);

      const data = await api(`/api/district/list?${params.toString()}`);
      if (data.success) {
        setMembers(data.members);
        setSelectedMembers(new Set());
      } else {
        setError(data.error || 'Failed to fetch members');
      }
    } catch (err) {
      setError(`Error: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  // ---- Client-side filtering (applied on top of API result) ----

  const clientFilteredMembers = React.useMemo(() => {
    return members.filter(member => {
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
    });
  }, [members, globalSearch, typeFilters, genderFilters, expirationFrom, expirationTo]);

  // Active search filter count (for badge in Filters component)
  const activeSearchFilterCount = React.useMemo(() => {
    let count = 0;
    if (globalSearch) count++;
    if (typeFilters.length > 0) count++;
    if (genderFilters.length > 0) count++;
    if (expirationFrom || expirationTo) count++;
    if (Object.values(columnFilters).some(v => v)) count++;
    return count;
  }, [globalSearch, typeFilters, genderFilters, expirationFrom, expirationTo, columnFilters]);

  const handleClearAllSearchFilters = () => {
    setGlobalSearch('');
    setTypeFilters([]);
    setGenderFilters([]);
    setExpirationFrom('');
    setExpirationTo('');
    setColumnFilters({});
  };

  // ---- Table helpers ----

  const toggleMember = (memberId) => {
    const newSelected = new Set(selectedMembers);
    if (newSelected.has(memberId)) {
      newSelected.delete(memberId);
    } else {
      newSelected.add(memberId);
    }
    setSelectedMembers(newSelected);
  };

  const formatDate = (dateStr, dateOnly = false) => {
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

  // getFilteredMembers: applies column filters on top of client-filtered members
  // used for select-all logic to match exactly what the table shows
  const getFilteredMembers = () => {
    const nonEmpty = Object.entries(columnFilters).filter(([, v]) => v);
    if (nonEmpty.length === 0) return clientFilteredMembers;
    return clientFilteredMembers.filter(member => {
      for (const [colKey, filterValue] of nonEmpty) {
        if (!getCellValue(member, colKey).toLowerCase().includes(filterValue.toLowerCase())) return false;
      }
      return true;
    });
  };

  const toggleAll = () => {
    const filteredMembers = getFilteredMembers();
    const filteredIds = filteredMembers.map((m) => m.MemberID);
    const allFilteredSelected = filteredIds.every(id => selectedMembers.has(id));
    if (allFilteredSelected && selectedMembers.size === filteredIds.length) {
      setSelectedMembers(new Set());
    } else {
      const newSelected = new Set(selectedMembers);
      filteredIds.forEach(id => newSelected.add(id));
      setSelectedMembers(newSelected);
    }
  };

  const toggleColumn = (columnKey) => {
    const newColumns = selectedColumns.includes(columnKey)
      ? selectedColumns.filter(c => c !== columnKey)
      : [...selectedColumns, columnKey];
    setSelectedColumns(newColumns);
  };

  const resetColumns = () => {
    setSelectedColumns(defaultColumns);
  };

  const handleSort = (columnKey) => {
    if (sortBy === columnKey) {
      updateSort(columnKey, sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      updateSort(columnKey, 'asc');
    }
  };

  const updateColumnFilter = (columnKey, value) => {
    setColumnFilters(prev => ({
      ...prev,
      [columnKey]: value
    }));
  };

  const handleExportCSV = (includeAll = false) => {
    const { exportToCSV } = window.DistrictExportHelpers;
    exportToCSV(selectedMembers, includeAll, selectedDistricts, showAllDistricts, selectedColumns, statusFilters, setError, setExportLoading);
  };

  const handleExportAllDistricts = () => {
    const { exportAllDistricts } = window.DistrictExportHelpers;
    exportAllDistricts(statusFilters, selectedColumns, setError, setExportLoading);
  };

  const handleExportAllAsSheet = () => {
    const { exportAllAsSheet } = window.DistrictExportHelpers;
    const colsForExport = selectedColumns.includes('District')
      ? selectedColumns
      : ['District', ...selectedColumns];
    exportAllAsSheet(statusFilters, colsForExport, setError, setExportLoading);
  };

  return (
    <div style={{ padding: '20px', maxWidth: '1600px', margin: '0 auto' }}>
      <div style={{ marginBottom: '24px' }}>
        <h2 style={{ margin: '0 0 16px 0', fontSize: '24px', fontWeight: '600' }}>
          Members by District
        </h2>
        <p style={{ color: 'var(--text2)', margin: '0', fontSize: '14px' }}>
          Select a district, customize columns, and export data.
        </p>
      </div>

      {error && (
        <div
          style={{
            padding: '12px',
            marginBottom: '16px',
            background: 'rgba(220, 38, 38, 0.1)',
            border: '1px solid rgba(220, 38, 38, 0.3)',
            borderRadius: 'var(--radius)',
            color: '#dc2626',
            fontSize: '13px',
          }}
        >
          {error}
        </div>
      )}

      {window.DistrictMemberFilters && React.createElement(window.DistrictMemberFilters, {
        districts,
        statusOptions,
        selectedDistricts,
        showAllDistricts,
        statusFilters,
        onDistrictChange: (newDistricts, newShowAll) => {
          setSelectedDistricts(newDistricts);
          setShowAllDistricts(newShowAll);
        },
        onStatusChange: setStatusFilters,
        loading,
        onRefresh: fetchMembers,
        onExportAllDistricts: handleExportAllDistricts,
        onExportAllAsSheet: handleExportAllAsSheet,
        exportLoading,
        selectedColumns,
        availableColumns,
        onColumnToggle: toggleColumn,
        onResetColumns: resetColumns,
        showColumnSelector,
        onShowColumnSelector: setShowColumnSelector,
        defaultColumns,
        // Search & filter props
        globalSearch,
        onGlobalSearch: setGlobalSearch,
        typeFilters,
        onTypeFiltersChange: setTypeFilters,
        genderFilters,
        onGenderFiltersChange: setGenderFilters,
        expirationFrom,
        onExpirationFromChange: setExpirationFrom,
        expirationTo,
        onExpirationToChange: setExpirationTo,
        onClearAllSearchFilters: handleClearAllSearchFilters,
        activeSearchFilterCount,
        members, // raw array for deriving type/gender options
      })}

      {(selectedDistricts.length > 0 || showAllDistricts) && clientFilteredMembers.length > 0 && window.DistrictMemberTable && React.createElement(window.DistrictMemberTable, {
        members: clientFilteredMembers,
        selectedMembers,
        sortBy,
        sortOrder,
        onSort: handleSort,
        onSelectMember: toggleMember,
        onSelectAll: toggleAll,
        selectedColumns,
        columnFilters,
        onUpdateColumnFilter: updateColumnFilter,
        onExportSelected: () => handleExportCSV(false),
        onExportAll: () => handleExportCSV(true),
        exportLoading,
        globalSearch,
      })}

      {/* Client filters active but no matches */}
      {(selectedDistricts.length > 0 || showAllDistricts) && !loading && members.length > 0 && clientFilteredMembers.length === 0 && (
        <div style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--text2)' }}>
          <p style={{ fontSize: '14px', marginBottom: '8px' }}>No members match your search</p>
          <p style={{ fontSize: '12px' }}>
            Try adjusting or{' '}
            <span
              onClick={handleClearAllSearchFilters}
              style={{ color: 'var(--accent)', cursor: 'pointer', textDecoration: 'underline' }}
            >
              clearing all filters
            </span>
          </p>
        </div>
      )}

      {/* API returned nothing */}
      {(selectedDistricts.length > 0 || showAllDistricts) && !loading && members.length === 0 && (
        <div style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--text2)' }}>
          <p style={{ fontSize: '14px', marginBottom: '8px' }}>No members found</p>
          {statusFilters.length > 0 && (
            <p style={{ fontSize: '12px' }}>Try changing the status filter</p>
          )}
        </div>
      )}

      {!showAllDistricts && selectedDistricts.length === 0 && (
        <div style={{ textAlign: 'center', padding: '60px 20px', color: 'var(--text2)' }}>
          <p style={{ fontSize: '16px', fontWeight: '500', marginBottom: '8px' }}>
            Select one or more districts to view members
          </p>
          <p style={{ fontSize: '13px' }}>
            {districts.length} districts available
          </p>
        </div>
      )}
    </div>
  );
};
