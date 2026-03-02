// ============================================================
// Admin functions: view pending events, unmatched payments, config CRUD
// Depends on: config.ts, sheets.ts, logger.ts
// Exposed GAS functions: getPendingEvents, getUnmatchedPayments,
//                        getConfig, updateConfigEntry
// ============================================================

function getPendingEvents(jsonRequest: string): string {
  const req = JSON.parse(jsonRequest) as ApiRequest<{ adminEmail: string }>;
  try {
    if (!isAdmin(req.payload.adminEmail)) {
      return jsonError(req.requestId, 'FORBIDDEN', 'Not authorized.');
    }
    const events = getPendingWebAppEvents();
    return jsonOk(req.requestId, { events });
  } catch (e: any) {
    return jsonError(req.requestId, 'INTERNAL_ERROR', String(e));
  }
}

function getUnmatchedPayments(jsonRequest: string): string {
  const req = JSON.parse(jsonRequest) as ApiRequest<{ adminEmail: string }>;
  try {
    if (!isAdmin(req.payload.adminEmail)) {
      return jsonError(req.requestId, 'FORBIDDEN', 'Not authorized.');
    }
    const payments = getUnmatchedGmailPayments();
    return jsonOk(req.requestId, { payments });
  } catch (e: any) {
    return jsonError(req.requestId, 'INTERNAL_ERROR', String(e));
  }
}

function getConfig(jsonRequest: string): string {
  const req = JSON.parse(jsonRequest) as ApiRequest<{ adminEmail: string; caller?: string }>;
  try {
    console.log('[mmr][getConfig] called by:', req.payload.caller || 'unknown', '| adminEmail:', req.payload.adminEmail);
    if (!isAdmin(req.payload.adminEmail)) {
      console.log('[mmr][getConfig] FORBIDDEN for:', req.payload.adminEmail);
      return jsonError(req.requestId, 'FORBIDDEN', 'Not authorized.');
    }
    const config = getConfigMap();
    console.log('[mmr][getConfig] returning', Object.keys(config).length, 'config keys');
    return jsonOk(req.requestId, { config });
  } catch (e: any) {
    console.error('[mmr][getConfig] error:', String(e));
    return jsonError(req.requestId, 'INTERNAL_ERROR', String(e));
  }
}

function updateConfigEntry(jsonRequest: string): string {
  const req = JSON.parse(jsonRequest) as ApiRequest<{ adminEmail: string; key: string; value: string }>;
  const { payload } = req;
  try {
    if (!isAdmin(payload.adminEmail)) {
      return jsonError(req.requestId, 'FORBIDDEN', 'Not authorized.');
    }
    setConfigValue(payload.key, payload.value);
    auditLog('CONFIG_UPDATE', {
      email: payload.adminEmail,
      state: { key: payload.key, value: payload.value },
    });
    return jsonOk(req.requestId, { message: 'Config updated.' });
  } catch (e: any) {
    return jsonError(req.requestId, 'INTERNAL_ERROR', String(e));
  }
}

function isAdmin(email: string): boolean {
  const adminEmails = getConfigValue('Admin_Emails')
    .split(',')
    .map(e => e.trim().toLowerCase())
    .filter(Boolean);
  return adminEmails.includes(email.trim().toLowerCase());
}
