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

function getPaymentProofs(jsonRequest: string): string {
  const req = JSON.parse(jsonRequest) as ApiRequest<{ adminEmail: string }>;
  try {
    if (!isAdmin(req.payload.adminEmail)) {
      return jsonError(req.requestId, 'FORBIDDEN', 'Not authorized.');
    }
    const sheet = getSheet(SHEET_NAMES.PAYMENT_PROOFS);
    const data = sheet.getDataRange().getValues().slice(1); // skip header
    const proofs = data.map(row => ({
      eventId: row[PP_COL.EVENT_ID],
      timestamp: row[PP_COL.TIMESTAMP],
      memberId: row[PP_COL.MEMBER_ID],
      email: row[PP_COL.EMAIL],
      eventName: row[PP_COL.EVENT_NAME],
      amount: row[PP_COL.AMOUNT],
      paymentDate: row[PP_COL.PAYMENT_DATE],
      payerName: row[PP_COL.PAYER_NAME],
      last4Digits: row[PP_COL.LAST_4_DIGITS],
      notes: row[PP_COL.NOTES],
      screenshotFileId: row[PP_COL.SCREENSHOT_FILE_ID],
      status: row[PP_COL.STATUS],
      gdriveFilePath: row[PP_COL.GDRIVE_FILE_PATH],
      ocrText: row[PP_COL.OCR_TEXT],
      ocrTimestamp: row[PP_COL.OCR_TIMESTAMP],
    }));
    return jsonOk(req.requestId, { proofs });
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

function getPublicConfig(jsonRequest: string): string {
  const req = JSON.parse(jsonRequest) as ApiRequest<{}>;
  try {
    console.log('mmr:getPublicConfig called, requestId =', req.requestId);
    const allConfig = getConfigMap();
    console.log('mmr:getPublicConfig allConfig keys =', Object.keys(allConfig).join(', '));

    const publicConfig: Record<string, string> = {};
    const publicKeys = ['ZelleHandle','VenmoHandle','PayPalHandle',
                        'ZelleQRCodeFileId','VenmoQRCodeFileId',
                        'IndividualPrice','FamilyPrice'];
    for (const key of publicKeys) {
      console.log(`mmr:getPublicConfig key="${key}" value="${allConfig[key] ?? '(missing)'}" `);
      if (allConfig[key]) publicConfig[key] = allConfig[key];
    }

    console.log('mmr:getPublicConfig returning keys =', Object.keys(publicConfig).join(', '));
    return jsonOk(req.requestId, { config: publicConfig });
  } catch (e: any) {
    console.error('mmr:getPublicConfig ERROR =', String(e));
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
