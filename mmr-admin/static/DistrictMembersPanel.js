/**
 * District Members Panel
 * Allows group leaders to view members by district and export selections as CSV.
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
  }, [selectedDistrict, statusFilter, renewedFilter]);

  const fetchDistricts = async () => {
    try {
      const response = await fetch('/api/district/districts');
      const data = await response.json();
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
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      if (selectedDistrict) params.append('district', selectedDistrict);
      if (statusFilter) params.append('status', statusFilter);
      if (renewedFilter) params.append('renewed', renewedFilter);

      const response = await fetch(`/api/district/list?${params.toString()}`);
      const data = await response.json();
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
    if (selectedMembers.size === members.length) {
      setSelectedMembers(new Set());
    } else {
      setSelectedMembers(new Set(members.map((m) => m.MemberID)));
    }
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

  const formatDate = (dateStr) => {
    if (!dateStr) return 'Never';
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  return (
    <div style={{ padding: '20px', maxWidth: '1400px', margin: '0 auto' }}>
      <div style={{ marginBottom: '24px' }}>
        <h2 style={{ margin: '0 0 16px 0', fontSize: '24px', fontWeight: '600' }}>
          Members by District
        </h2>
        <p style={{ color: 'var(--text2)', margin: '0', fontSize: '14px' }}>
          Select a district to view members. Check boxes to select for export.
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

      {/* Filters */}
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

      {/* Members Table */}
      {selectedDistrict && members.length > 0 && (
        <div
          style={{
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius)',
            overflow: 'hidden',
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
                checked={selectedMembers.size === members.length && members.length > 0}
                onChange={toggleAll}
                style={{ marginRight: '8px', cursor: 'pointer' }}
              />
              {selectedMembers.size} of {members.length} selected
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

          {/* Table */}
          <table
            style={{
              width: '100%',
              borderCollapse: 'collapse',
              fontSize: '13px',
            }}
          >
            <thead>
              <tr style={{ background: 'var(--surface)', borderBottom: '1px solid var(--border)' }}>
                <th
                  style={{
                    padding: '12px 16px',
                    textAlign: 'left',
                    fontWeight: '600',
                    color: 'var(--text2)',
                    width: '40px',
                  }}
                >
                  □
                </th>
                <th
                  style={{
                    padding: '12px 16px',
                    textAlign: 'left',
                    fontWeight: '600',
                    color: 'var(--text2)',
                  }}
                >
                  Member ID
                </th>
                <th
                  style={{
                    padding: '12px 16px',
                    textAlign: 'left',
                    fontWeight: '600',
                    color: 'var(--text2)',
                  }}
                >
                  Name
                </th>
                <th
                  style={{
                    padding: '12px 16px',
                    textAlign: 'left',
                    fontWeight: '600',
                    color: 'var(--text2)',
                  }}
                >
                  WeChat ID
                </th>
                <th
                  style={{
                    padding: '12px 16px',
                    textAlign: 'left',
                    fontWeight: '600',
                    color: 'var(--text2)',
                  }}
                >
                  Email
                </th>
                <th
                  style={{
                    padding: '12px 16px',
                    textAlign: 'left',
                    fontWeight: '600',
                    color: 'var(--text2)',
                  }}
                >
                  Phone
                </th>
                <th
                  style={{
                    padding: '12px 16px',
                    textAlign: 'left',
                    fontWeight: '600',
                    color: 'var(--text2)',
                  }}
                >
                  Status
                </th>
                <th
                  style={{
                    padding: '12px 16px',
                    textAlign: 'left',
                    fontWeight: '600',
                    color: 'var(--text2)',
                  }}
                >
                  Last Login
                </th>
                <th
                  style={{
                    padding: '12px 16px',
                    textAlign: 'left',
                    fontWeight: '600',
                    color: 'var(--text2)',
                  }}
                >
                  Modified
                </th>
                <th
                  style={{
                    padding: '12px 16px',
                    textAlign: 'left',
                    fontWeight: '600',
                    color: 'var(--text2)',
                  }}
                >
                  Expires
                </th>
              </tr>
            </thead>
            <tbody>
              {members.map((member) => (
                <tr
                  key={member.MemberID}
                  style={{
                    borderBottom: '1px solid var(--border)',
                    background: selectedMembers.has(member.MemberID) ? 'rgba(var(--accent-rgb), 0.05)' : 'transparent',
                    transition: 'background 0.15s',
                  }}
                >
                  <td style={{ padding: '12px 16px', textAlign: 'center' }}>
                    <input
                      type="checkbox"
                      checked={selectedMembers.has(member.MemberID)}
                      onChange={() => toggleMember(member.MemberID)}
                      style={{ cursor: 'pointer' }}
                    />
                  </td>
                  <td style={{ padding: '12px 16px', fontFamily: 'monospace', color: 'var(--accent)' }}>
                    {member.MemberID}
                  </td>
                  <td style={{ padding: '12px 16px', fontWeight: '500' }}>
                    {member.Name}
                  </td>
                  <td style={{ padding: '12px 16px', color: 'var(--text2)' }}>
                    {member.WeChatID || '—'}
                  </td>
                  <td
                    style={{
                      padding: '12px 16px',
                      color: 'var(--accent)',
                      fontSize: '12px',
                      wordBreak: 'break-all',
                    }}
                  >
                    {member.Email}
                  </td>
                  <td style={{ padding: '12px 16px', color: 'var(--text2)' }}>
                    {member.PhoneNumber || '—'}
                  </td>
                  <td style={{ padding: '12px 16px' }}>
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
                  </td>
                  <td style={{ padding: '12px 16px', color: 'var(--text2)', fontSize: '12px' }}>
                    {formatDate(member.LastLoginDate)}
                  </td>
                  <td style={{ padding: '12px 16px', color: 'var(--text2)', fontSize: '12px' }}>
                    {formatDate(member.LastModified)}
                  </td>
                  <td style={{ padding: '12px 16px', color: 'var(--text2)', fontSize: '12px' }}>
                    {formatDate(member.Expiration)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
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
