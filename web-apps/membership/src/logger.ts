// ============================================================
// Audit log helper
// Depends on: config.ts, sheets.ts
// ============================================================

function auditLog(
  action: string,
  details: {
    sessionID?: string;
    memberID?: string;
    email?: string;
    eventID?: string;
    state?: object;
    errorCode?: string;
    errorMessage?: string;
  }
): void {
  try {
    const sheet = getSheet(SHEET_NAMES.ACTIVITY_LOG);
    sheet.appendRow([
      generateLogID(),
      new Date().toISOString(),
      details.sessionID ?? '',
      details.memberID ?? '',
      details.email ?? '',
      details.eventID ?? '',
      action,
      details.state ? JSON.stringify(details.state) : '',
      details.errorCode ?? '',
      details.errorMessage ? details.errorMessage.substring(0, 500) : '',
    ]);
  } catch (e) {
    // Logging must never crash the main flow
    console.error('auditLog failed:', e);
  }
}
