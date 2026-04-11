/**
 * District Members Panel (Core)
 * State management and data fetching for district member browsing
 * Sub-components: DistrictMemberFilters, DistrictMemberTable
 */

window.DistrictMembersPanel = () => {
  const [districts, setDistricts] = React.useState([]);
  const [selectedDistrict, setSelectedDistrict] = React.useState('');
  const [members, setMembers] = React.useState([]);
  const [selectedMembers, setSelectedMembers] = React.useState(new Set());
  const [loading, setLoading] = React.useState(false);
  const [statusFilter, setStatusFilter] = React.useState('');
  const [renewedFilter, setRenewedFilter] = React.useState('');
  const [error, setError] = React.useState('');
  const [exportLoading, setExportLoading] = React.useState(false);
  const [sortBy, setSortBy] = React.useState('District');
  const [sortOrder, setSortOrder] = React.useState('asc');
  const [showColumnSelector, setShowColumnSelector] = React.useState(false);
  const [columnFilters, setColumnFilters] = React.useState({});

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
        // Migrate stale column keys that no longer exist in the DB
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
  }, []);

  React.useEffect(() => {
    if (selectedDistrict) {
      fetchMembers();
    } else {
      setMembers([]);
      setSelectedMembers(new Set());
    }
  }, [selectedDistrict, statusFilter, renewedFilter, sortBy, sortOrder]);

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

  const fetchMembers = async () => {
    const { api } = window.mmrUtils;
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      if (selectedDistrict) params.append('district', selectedDistrict);
      if (statusFilter) params.append('status', statusFilter);
      if (renewedFilter) params.append('renewed', renewedFilter);
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

  const toggleMember = (memberId) => {
    const newSelected = new Set(selectedMembers);
    if (newSelected.has(memberId)) {
      newSelected.delete(memberId);
    } else {
      newSelected.add(memberId);
    }
    setSelectedMembers(newSelected);
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

  const getFilteredMembers = () => {
    if (Object.keys(columnFilters).length === 0) {
      return members;
    }
    return members.filter(member => {
      for (const [colKey, filterValue] of Object.entries(columnFilters)) {
        if (!filterValue) continue;
        const cellValue = getCellValue(member, colKey).toLowerCase();
        const searchValue = filterValue.toLowerCase();
        if (!cellValue.includes(searchValue)) return false;
      }
      return true;
    });
  };

  const formatDate = (dateStr, dateOnly = false) => {
    if (!dateStr) return '—';
    const date = new Date(dateStr);
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

  const handleExportCSV = (includeAll = false) => {
    const { exportToCSV } = window.DistrictExportHelpers;
    exportToCSV(selectedMembers, includeAll, selectedDistrict, selectedColumns, statusFilter, renewedFilter, setError, setExportLoading);
  };

  const handleExportAllDistricts = () => {
    const { exportAllDistricts } = window.DistrictExportHelpers;
    exportAllDistricts(statusFilter, renewedFilter, selectedColumns, setError, setExportLoading);
  };

  const handleExportAllAsSheet = () => {
    const { exportAllAsSheet } = window.DistrictExportHelpers;
    exportAllAsSheet(statusFilter, renewedFilter, selectedColumns, setError, setExportLoading);
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
        selectedDistrict,
        statusFilter,
        renewedFilter,
        onDistrictChange: setSelectedDistrict,
        onStatusChange: setStatusFilter,
        onRenewalChange: setRenewedFilter,
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
      })}

      {selectedDistrict && members.length > 0 && window.DistrictMemberTable && React.createElement(window.DistrictMemberTable, {
        members,
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
      })}

      {selectedDistrict && !loading && members.length === 0 && (
        <div
          style={{
            textAlign: 'center',
            padding: '40px 20px',
            color: 'var(--text2)',
          }}
        >
          <p style={{ fontSize: '14px', marginBottom: '8px' }}>No members found in this district</p>
          {statusFilter && (
            <p style={{ fontSize: '12px' }}>
              Try changing the status filter
            </p>
          )}
        </div>
      )}

      {!selectedDistrict && (
        <div
          style={{
            textAlign: 'center',
            padding: '60px 20px',
            color: 'var(--text2)',
          }}
        >
          <p style={{ fontSize: '16px', fontWeight: '500', marginBottom: '8px' }}>
            Select a district to view members
          </p>
          <p style={{ fontSize: '13px' }}>
            {districts.length} districts available
          </p>
        </div>
      )}
    </div>
  );
};
