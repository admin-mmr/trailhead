/**
 * District Export Helpers
 * CSV and Excel export functions for district members
 */

window.DistrictExportHelpers = (() => {
  const exportToCSV = async (selectedMembers, includeAll, selectedDistrict, selectedColumns, statusFilter, renewedFilter, setError, setExportLoading) => {
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

  const exportAllDistricts = async (statusFilter, renewedFilter, selectedColumns, setError, setExportLoading) => {
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

  const exportAllAsSheet = async (statusFilter, renewedFilter, selectedColumns, setError, setExportLoading) => {
    setExportLoading(true);
    try {
      const response = await fetch('/api/district/export-all-sheet', {
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
        a.download = `all_members_${new Date().toISOString().slice(0, 10)}.csv`;
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

  return { exportToCSV, exportAllDistricts, exportAllAsSheet };
})();
