/**
 * District Members Panel (Core)
 * Thin render shell for district member browsing. All state, effects, data
 * fetching, and handlers live in window.useDistrictMembersPanel
 * (DistrictMembersPanelState.js). Column config + pure helpers live in
 * window.DistrictPanelHelpers (DistrictMembersPanelHelpers.js).
 * Sub-components: window.DistrictMemberFilters, window.DistrictMemberTable.
 */

window.DistrictMembersPanel = () => {
  const {
    availableColumns, defaultColumns,
    districts, statusOptions, selectedDistricts, showAllDistricts, members,
    selectedMembers, loading, statusFilters, error, exportLoading, sortBy,
    sortOrder, showColumnSelector, columnFilters, globalSearch, typeFilters,
    genderFilters, expirationFrom, expirationTo, selectedColumns,
    setSelectedDistricts, setShowAllDistricts, setStatusFilters,
    setShowColumnSelector, setGlobalSearch, setTypeFilters, setGenderFilters,
    setExpirationFrom, setExpirationTo,
    clientFilteredMembers, activeSearchFilterCount,
    fetchMembers, handleClearAllSearchFilters, toggleMember, toggleAll,
    toggleColumn, resetColumns, handleSort, updateColumnFilter, handleExportCSV,
    handleExportAllDistricts, handleExportAllAsSheet,
  } = window.useDistrictMembersPanel();

  return (
    <div className="mobile-tight" style={{ padding: '20px', maxWidth: '1600px', margin: '0 auto' }}>
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
