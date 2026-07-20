/**
 * District Members Panel State
 * Custom hook holding all state, effects, data fetching, derived data, and
 * handlers for DistrictMembersPanel. Exposed as window.useDistrictMembersPanel.
 * Depends on window.DistrictPanelHelpers (DistrictMembersPanelHelpers.js) and
 * window.DistrictExportHelpers (DistrictExport.js).
 */

window.useDistrictMembersPanel = () => {
  const { availableColumns, defaultColumns, getCellValue, memberMatchesSearch } = window.DistrictPanelHelpers;

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
    return members.filter(member => memberMatchesSearch(member, {
      globalSearch, typeFilters, genderFilters, expirationFrom, expirationTo,
    }));
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

  return {
    // config
    availableColumns, defaultColumns,
    // state
    districts, statusOptions, selectedDistricts, showAllDistricts, members,
    selectedMembers, loading, statusFilters, error, exportLoading, sortBy,
    sortOrder, showColumnSelector, columnFilters, globalSearch, typeFilters,
    genderFilters, expirationFrom, expirationTo, selectedColumns,
    // setters used by render
    setSelectedDistricts, setShowAllDistricts, setStatusFilters,
    setShowColumnSelector, setGlobalSearch, setTypeFilters, setGenderFilters,
    setExpirationFrom, setExpirationTo,
    // derived
    clientFilteredMembers, activeSearchFilterCount,
    // handlers
    fetchMembers, handleClearAllSearchFilters, toggleMember, toggleAll,
    toggleColumn, resetColumns, handleSort, updateColumnFilter, handleExportCSV,
    handleExportAllDistricts, handleExportAllAsSheet,
  };
};
