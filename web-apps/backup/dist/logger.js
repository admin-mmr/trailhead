"use strict";
// ============================================================
// Audit log helper
// Depends on: config.ts, sheets.ts
// ============================================================
function auditLog(action, details) {
    var _a, _b, _c, _d, _e;
    try {
        console.log('[mmr][audit]', action, JSON.stringify(details));
        const sheet = getSheet(SHEET_NAMES.ACTIVITY_LOG);
        sheet.appendRow([
            generateLogID(),
            new Date().toISOString(),
            (_a = details.sessionID) !== null && _a !== void 0 ? _a : '',
            (_b = details.memberID) !== null && _b !== void 0 ? _b : '',
            (_c = details.email) !== null && _c !== void 0 ? _c : '',
            (_d = details.eventID) !== null && _d !== void 0 ? _d : '',
            action,
            details.state ? JSON.stringify(details.state) : '',
            (_e = details.errorCode) !== null && _e !== void 0 ? _e : '',
            details.errorMessage ? details.errorMessage.substring(0, 500) : '',
        ]);
    }
    catch (e) {
        // Logging must never crash the main flow
        console.error('auditLog failed:', e);
    }
}
// ── globalThis exports for test environment ──────────────────
globalThis.auditLog = auditLog;
