/**
 * Members Status Panel — thin tab dispatcher.
 *
 * Sub-tabs (each rendered by its own component file):
 *   change-status  → MembersChangeStatus
 *   mark-active    → MembersMarkActive
 *   revert-status  → MembersRevertStatus
 *   restore-log    → MembersRestoreLog
 *
 * Props:
 *   initialSubTab — start on this sub-tab (used when MembersPanel embeds us)
 *   hideNav       — hide the title and tab bar (parent owns navigation)
 *
 * Each child sub-component manages its own state. The parent owns only the
 * active tab and the toast banner; children call setToast(msg) on success.
 */

initComponent('MembersStatusPanel', (props) => {
  const hideNav = props && props.hideNav;
  const [subTab, setSubTab] = useState((props && props.initialSubTab) || 'change-status');
  const [toast, setToast] = useState('');

  const renderSubTab = () => {
    if (subTab === 'change-status' && window.MembersChangeStatus) {
      return React.createElement(window.MembersChangeStatus, { setToast });
    }
    if (subTab === 'mark-active' && window.MembersMarkActive) {
      return React.createElement(window.MembersMarkActive, { setToast });
    }
    if (subTab === 'revert-status' && window.MembersRevertStatus) {
      return React.createElement(window.MembersRevertStatus, { setToast });
    }
    if (subTab === 'restore-log' && window.MembersRestoreLog) {
      return React.createElement(window.MembersRestoreLog, { setToast });
    }
    return null;
  };

  return (
    <div>
      {!hideNav && <h2 style={{ marginBottom: 16 }}>Member Status Management</h2>}

      {!hideNav && (
        <div className="tabs" style={{ marginBottom: 24 }}>
          <button className={`tab ${subTab === 'change-status' ? 'active' : ''}`} onClick={() => setSubTab('change-status')}>👤 Change Status</button>
          <button className={`tab ${subTab === 'mark-active' ? 'active' : ''}`} onClick={() => setSubTab('mark-active')}>✅ Mark Active</button>
          <button className={`tab ${subTab === 'revert-status' ? 'active' : ''}`} onClick={() => setSubTab('revert-status')}>↩ Revert Status</button>
          <button className={`tab ${subTab === 'restore-log' ? 'active' : ''}`} onClick={() => setSubTab('restore-log')}>📋 Restore from Log</button>
        </div>
      )}

      {toast && (
        <div className="toast" style={{ marginBottom: 16 }}>
          {toast}
          <button style={{ marginLeft: 'auto', background: 'none', border: 'none', color: 'inherit', cursor: 'pointer' }} onClick={() => setToast('')}>✕</button>
        </div>
      )}

      {renderSubTab()}
    </div>
  );
});
