/**
 * Members Panel — thin tab dispatcher.
 *
 * Sub-tabs (each rendered by its own component file):
 *   update-family        → MembersUpdateFamily
 *   upgrade-to-family    → MembersUpgradeFamily
 *   change-district      → MembersChangeDistrict
 *   change-status        ┐
 *   mark-active          ├─ MembersStatusPanel (with hideNav + initialSubTab)
 *   revert-status        │
 *   restore-log          ┘
 *   mark-unused          → MembersMarkUnused
 *
 * Each child sub-tab manages its own search/edit state. The parent owns only
 * the active tab and the toast banner; sub-components call setToast(msg) on
 * successful operations.
 */

initComponent('MembersPanel', () => {
  const [subTab, setSubTab] = useState('update-family');
  const [toast, setToast] = useState('');

  const renderSubTab = () => {
    if (subTab === 'update-family' && window.MembersUpdateFamily) {
      return React.createElement(window.MembersUpdateFamily, { setToast });
    }
    if (subTab === 'upgrade-to-family' && window.MembersUpgradeFamily) {
      return React.createElement(window.MembersUpgradeFamily, { setToast });
    }
    if (subTab === 'change-district' && window.MembersChangeDistrict) {
      return React.createElement(window.MembersChangeDistrict, { setToast });
    }
    if (subTab === 'mark-unused' && window.MembersMarkUnused) {
      return React.createElement(window.MembersMarkUnused, { setToast });
    }
    if (['change-status', 'mark-active', 'revert-status', 'restore-log'].includes(subTab) && window.MembersStatusPanel) {
      // Status sub-tabs are owned by MembersStatusPanel; we just forward intent.
      return (
        <div key={subTab}>
          {React.createElement(window.MembersStatusPanel, {
            initialSubTab: subTab,
            hideNav: true,
          })}
        </div>
      );
    }
    return null;
  };

  return (
    <div>
      <h2 style={{ marginBottom: 16 }}>Members Management</h2>

      <div className="tabs" style={{ marginBottom: 24 }}>
        <button className={`tab ${subTab === 'update-family' ? 'active' : ''}`} onClick={() => setSubTab('update-family')}>Update Family</button>
        <button className={`tab ${subTab === 'upgrade-to-family' ? 'active' : ''}`} onClick={() => setSubTab('upgrade-to-family')}>Upgrade to Family</button>
        <button className={`tab ${subTab === 'change-district' ? 'active' : ''}`} onClick={() => setSubTab('change-district')}>Change District</button>
        <button className={`tab ${subTab === 'change-status' ? 'active' : ''}`} onClick={() => setSubTab('change-status')}>Change Status</button>
        <button className={`tab ${subTab === 'mark-active' ? 'active' : ''}`} onClick={() => setSubTab('mark-active')}>Mark Active</button>
        <button className={`tab ${subTab === 'mark-unused' ? 'active' : ''}`} onClick={() => setSubTab('mark-unused')}>Mark as Unused</button>
        <button className={`tab ${subTab === 'revert-status' ? 'active' : ''}`} onClick={() => setSubTab('revert-status')}>Revert Status</button>
        <button className={`tab ${subTab === 'restore-log' ? 'active' : ''}`} onClick={() => setSubTab('restore-log')}>Restore from Log</button>
      </div>

      {toast && (
        <div
          className="toast"
          style={{ position: 'relative', bottom: 'auto', right: 'auto', marginBottom: 16 }}
          onAnimationEnd={() => setToast('')}
        >
          {toast}
        </div>
      )}

      {renderSubTab()}
    </div>
  );
});
