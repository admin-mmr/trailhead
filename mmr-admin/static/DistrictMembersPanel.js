/**
 * District Members Panel with Column Selector and Sorting
 * Allows viewing, filtering, sorting, and exporting members by district.
 * Column selection is persisted to localStorage.
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

  // Available columns with labels
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

  // Default columns
  const defaultColumns = [
    'District', 'MemberID', 'Name', 'Status', 'Expiration', 'Gender',
    'WeChatID', 'Email', 'Type', 'FamilyID', 'PaymentDate',
    'MembershipFeePaid', 'PaymentTransaction'
  ];

  // Load selected columns from localStorage
  const [selectedColumns, setSelectedColumns] = React.useState(() => {
    try {
      const saved = localStorage.getItem('mmr_selected_columns');
      return saved ? JSON.parse(saved) : defaultColumns;
    } catch {
      return defaultColumns;
    }
  });

  // Save selected columns to localStorage
  React.useEffect(() => {
    try {
      localStorage.setItem('mmr_selected_columns', JSON.stringify(selectedColumns));
    } catch {
      // Silently fail if localStorage unavailable
    }
  }, [selectedColumns]);

  // Load sort preferences from localStorage
  React.useEffect(() => {
    try {
      const saved = localStorage.getItem('mmr_sort_preferences');
      if (saved) {
        const prefs = JSON.parse(saved);
        setSortBy(prefs.sortBy || 'District');
        setSortOrder(prefs.sortOrder || 'asc');
      }
    } catch {
      // Silently fail
    }
  }, []);

  // Save sort preferences to localStorage
  const updateSort = (newSortBy, newSortOrder) => {
    setSortBy(newSortBy);
    setSortOrder(newSortOrder);
    try {
      localStorage.setItem('mmr_sort_preferences', JSON.stringify({
        sortBy: newSortBy,
        sortOrder: newSortOrder
      }));
    } catch {
      // Silently fail
    }
  };

  // Fetch districts on mount
  React.useEffect(() => {
    fetchDistricts();
  }, []);

  // Fetch members when district or filters change
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

    // If all filtered members are selected, deselect all; otherwise select all filtered
    const allFilteredSelected = filteredIds.every(id => selectedMembers.has(id));

    if (allFilteredSelected && selectedMembers.size === filteredIds.length) {
      setSelectedMembers(new Set());
    } else {
      // Add filtered members to selection (keep existing selections)
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
      // Toggle order if clicking same column
      updateSort(columnKey, sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      // New column, default to ascending
      updateSort(columnKey, 'asc');
    }
  };

  // Format date with optional time
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

  // Get column label
  const getColumnLabel = (key) => {
    const col = availableColumns.find(c => c.key === key);
    return col ? col.label : key;
  };

  // Get cell value
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
        if (!filterValue) continue; // Skip empty filters

        const cellValue = getCellValue(member, colKey).toLowerCase();
        const searchValue = filterValue.toLowerCase();

        if (!cellValue.includes(searchValue)) {
          return false;
        }
      }
      return true;
    });
  };

  const exportCSV = async (includeAll = false) => {
    setExportLoading(true);
    try {
      const response = await fetch('/api/district/export-csv', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          memberIds: Array.from(selectedMembers),
          includeAll,
          district: selectedDistrict,
          columns: selectedColumns,
          filters: { status: statusFilter, renewed: renewedFilter },
        }),
      });

      if (response.ok) {
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `members_${new Date().toISOString().slice(0, 10)}.csv`;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);
      } else {
        const data = await response.json();
        setError(data.error || 'Export failed');
      }
    } catch (err) {
      setError(`Export error: ${err.message}`);
    } finally {
      setExportLoading(false);
    }
  };

  const exportAllDistricts = async () => {
    setExportLoading(true);
    try {
      const response = await fetch('/api/district/export-all-districts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: statusFilter,
          renewed: renewedFilter,
          columns: selectedColumns,
        }),
      });

      if (response.ok) {
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `all_districts_members_${new Date().toISOString().slice(0, 10)}.zip`;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);
      } else {
        const data = await response.json();
        setError(data.error || 'Export failed');
      }
    } catch (err) {
      setError(`Export error: ${err.message}`);
    } finally {
      setExportLoading(false);
    }
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
            onChange={(e) => setSelectedDistrict(e.target.value)}
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
            onChange={(e) => setStatusFilter(e.target.value)}
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
            <option value="">All Statuses</option>
            <option value="active">Active</option>
            <option value="not active">Not Active</option>
            <option value="pending">Pending</option>
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
            onChange={(e) => setRenewedFilter(e.target.value)}
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
              onClick={fetchMembers}
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
            onClick={exportAllDistricts}
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
            {exportLoading ? 'Exporting...' : '⬇ Export All Districts'}
          </button>
        </div>
      </div>

      {/* Column Selector */}
      {selectedDistrict && members.length > 0 && (
        <div style={{ marginBottom: '20px', position: 'relative' }}>
          <button
            onClick={() => setShowColumnSelector(!showColumnSelector)}
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
                  onClick={resetColumns}
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
                    onChange={() => toggleColumn(col.key)}
                    style={{ marginRight: '8px', cursor: 'pointer' }}
                  />
                  {col.label}
                </label>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Members Table */}
      {selectedDistrict && members.length > 0 && (
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
                checked={selectedMembers.size === getFilteredMembers().length && getFilteredMembers().length > 0}
                onChange={toggleAll}
                style={{ marginRight: '8px', cursor: 'pointer' }}
              />
              {selectedMembers.size} of {getFilteredMembers().length} visible selected
            </div>

            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                onClick={() => exportCSV(false)}
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
                onClick={() => exportCSV(true)}
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
                      onClick={() => handleSort(colKey)}
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
                        onChange={(e) => updateColumnFilter(colKey, e.target.value)}
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
                {getFilteredMembers().map((member) => (
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
                        onChange={() => toggleMember(member.MemberID)}
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
          {members.length > 0 && getFilteredMembers().length === 0 && (
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
      )}

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
