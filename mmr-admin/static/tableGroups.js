/**
 * Table Groups Configuration for Data Browser
 * Hybrid Domain + Type classification
 */

const TABLE_GROUPS = [
  {
    domain: '📋 Membership',
    color: '#3b82f6', // blue
    tables: [
      { name: 'members', type: 'Main', description: 'Member registry with status & expiration' },
      { name: 'admin_member_overrides', type: 'Admin', description: 'Manual member status changes & audits' },
    ],
  },
  {
    domain: '💰 Payments',
    color: '#10b981', // green
    tables: [
      { name: 'payments', type: 'Main', description: 'Processed payment records' },
      { name: 'submissions', type: 'Main', description: 'Membership fee submissions (pending/approved)' },
      { name: 'gmail_transactions', type: 'Main', description: 'Raw Gmail inbox payment transactions' },
    ],
  },
  {
    domain: '🏃 NYRR Events',
    color: '#f59e0b', // amber
    tables: [
      { name: 'nyrr_events', type: 'Main', description: 'Marathon & race events' },
      { name: 'nyrr_event_runners', type: 'Main', description: 'Event participants & results (large)' },
      { name: 'nyrr_processing_log', type: 'Log', description: 'Event processing history' },
    ],
  },
  {
    domain: '🔄 Operations & Sync',
    color: '#8b5cf6', // purple
    tables: [
      { name: 'sync_jobs', type: 'Main', description: 'Async job tracking & status' },
      { name: 'sheets_sync_log', type: 'Log', description: 'Google Sheets sync history' },
      { name: 'member_log', type: 'Log', description: 'Member change audit trail (large)' },
      { name: 'activity_log', type: 'Log', description: 'System activity & operations log' },
    ],
  },
  {
    domain: '⚙️ Admin & Config',
    color: '#6366f1', // indigo
    tables: [
      { name: 'admin_users', type: 'Admin', description: 'Admin access control & roles' },
      { name: 'config', type: 'Config', description: 'System configuration & settings' },
      { name: 'password_reset_tokens', type: 'Admin', description: 'Auth tokens & password resets' },
      { name: 'viewer_user_settings', type: 'Config', description: 'UI preferences & user settings' },
      { name: 'error_context', type: 'Config', description: 'Error logging & context tracking' },
      { name: 'schema_migrations', type: 'Config', description: 'Database migration history' },
    ],
  },
];

// Export as global for use in table-browser.html
window.TABLE_GROUPS = TABLE_GROUPS;
