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
    // Payment proofs are now stored directly in WebApp-Events.
    // Return all events that have a screenshotFileId attached.
    const sheet = getSheet(SHEET_NAMES.WEBAPP_EVENTS);
    const data = sheet.getDataRange().getValues().slice(1); // skip header
    const proofs = data
      .filter(row => row[WE_COL.SCREENSHOT_FILE_ID])
      .map(row => ({
        eventId:         String(row[WE_COL.EVENT_ID]),
        timestamp:       String(row[WE_COL.TIMESTAMP]),
        memberId:        String(row[WE_COL.MEMBER_ID]),
        email:           String(row[WE_COL.EMAIL]),
        eventName:       String(row[WE_COL.PAYMENT_INTENT]),
        amount:          Number(row[WE_COL.AMOUNT]) || 0,
        paymentDate:     String(row[WE_COL.PAYMENT_DATE]      || ''),
        payerName:       String(row[WE_COL.PAYER_NAME]),
        last4Digits:     String(row[WE_COL.LAST_4_DIGITS]),
        notes:           String(row[WE_COL.NOTES]),
        screenshotFileId: String(row[WE_COL.SCREENSHOT_FILE_ID]),
        status:          String(row[WE_COL.STATUS]),
        gdriveFilePath:  String(row[WE_COL.GDRIVE_FILE_PATH]  || ''),
        ocrText:         String(row[WE_COL.OCR_TEXT]          || ''),
        ocrTimestamp:    String(row[WE_COL.OCR_TIMESTAMP]     || ''),
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
                        'IndividualPrice','FamilyPrice','FamilyUpgradePrice'];
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
  const adminEmails = getConfigValue('AdminEmails')
    .split(',')
    .map(e => e.trim().toLowerCase())
    .filter(Boolean);
  return adminEmails.includes(email.trim().toLowerCase());
}

// Manually link an unmatched Gmail payment to a WebApp-Events row
function manualMatch(jsonRequest: string): string {
  const req = JSON.parse(jsonRequest) as ApiRequest<{
    adminEmail: string;
    eventID: string;
    messageId: string;
  }>;
  const payload = req.payload;

  try {
    if (!isAdmin(payload.adminEmail)) {
      return jsonError(req.requestId, 'FORBIDDEN', 'Not authorized.');
    }

    const eventID = (payload.eventID || '').trim();
    const messageId = (payload.messageId || '').trim();
    if (!eventID || !messageId) {
      return jsonError(req.requestId, 'BAD_REQUEST', 'eventID and messageId are required.');
    }

    const eventsSheet = getSheet(SHEET_NAMES.WEBAPP_EVENTS);
    const gmailSheet  = getSheet(SHEET_NAMES.FETCH_GMAIL);
    if (!eventsSheet || !gmailSheet) {
      return jsonError(req.requestId, 'SHEET_MISSING', 'Required sheets not found.');
    }

    const eventsValues = eventsSheet.getDataRange().getValues();
    const gmailValues  = gmailSheet.getDataRange().getValues();

    let eventRowIndex = -1;
    let gmailRowIndex = -1;

    // Find WebApp-Events row by EventID
    for (let i = 1; i < eventsValues.length; i++) {
      const row = eventsValues[i];
      if (String(row[WE_COL.EVENT_ID]).trim() === eventID) {
        eventRowIndex = i;
        break;
      }
    }

    if (eventRowIndex === -1) {
      return jsonError(req.requestId, 'NOT_FOUND', 'Event not found.');
    }

    // Find Fetch-Gmail row by MessageId
    for (let i = 1; i < gmailValues.length; i++) {
      const row = gmailValues[i];
      if (String(row[FG_COL.MESSAGE_ID]).trim() === messageId) {
        gmailRowIndex = i;
        break;
      }
    }

    if (gmailRowIndex === -1) {
      return jsonError(req.requestId, 'NOT_FOUND', 'Gmail payment not found.');
    }

    const eventRow = eventsValues[eventRowIndex];
    const gmailRow = gmailValues[gmailRowIndex];

    const transactionNumber = String(gmailRow[FG_COL.TRANSACTION_NUMBER] || '');
    const amount            = Number(gmailRow[FG_COL.AMOUNT]) || 0;

    // Update WebApp-Events row: Status -> Matched, set matched fields
    eventRow[WE_COL.STATUS]                 = 'Matched';
    eventRow[WE_COL.MATCHED_MESSAGE_ID]       = messageId;
    eventRow[WE_COL.MATCHED_TRANSACTION_NUMBER] = transactionNumber;
    // Optionally record note that this was a manual match
    const oldNotes = String(eventRow[WE_COL.NOTES] || '');
    const noteLine = `Manual match by ${payload.adminEmail} on ${new Date().toISOString()} amount=${amount}`;
    eventRow[WE_COL.NOTES] = oldNotes ? (oldNotes + ' | ' + noteLine) : noteLine;

    eventsSheet.getRange(eventRowIndex + 1, 1, 1, eventRow.length).setValues([eventRow]);

    // Update Fetch-Gmail row: mark processed and link EventID
    gmailRow[FG_COL.PROCESSED]    = true;
    gmailRow[FG_COL.WEBAPP_EVENT_ID] = eventID;
    gmailSheet.getRange(gmailRowIndex + 1, 1, 1, gmailRow.length).setValues([gmailRow]);

    auditLog('MANUALMATCH', {
      email: payload.adminEmail,
      eventID,
      state: { messageId, transactionNumber, amount },
    });

    // Return minimal summary for frontend refresh
    const updatedEvent: WebAppEvent = {
      eventID:        String(eventRow[WE_COL.EVENT_ID]),
      eventType:      String(eventRow[WE_COL.EVENT_TYPE])  as WebAppEvent['eventType'],
      timestamp:      String(eventRow[WE_COL.TIMESTAMP]),
      memberID:       String(eventRow[WE_COL.MEMBER_ID]),
      email:          String(eventRow[WE_COL.EMAIL]),
      paymentIntent:  String(eventRow[WE_COL.PAYMENT_INTENT]) as WebAppEvent['paymentIntent'],
      amount:         Number(eventRow[WE_COL.AMOUNT]) || 0,
      paymentMethod:  String(eventRow[WE_COL.PAYMENT_METHOD]) as WebAppEvent['paymentMethod'],
      payerName:      String(eventRow[WE_COL.PAYER_NAME]),
      memoField:      String(eventRow[WE_COL.MEMO_FIELD]),
      last4Digits:    String(eventRow[WE_COL.LAST_4_DIGITS]),
      familyMemberEmails: String(eventRow[WE_COL.FAMILY_MEMBER_EMAILS]),
      status:        String(eventRow[WE_COL.STATUS]) as WebAppEvent['status'],  
      matchedMessageId:       String(eventRow[WE_COL.MATCHED_MESSAGE_ID]),
      matchedTransactionNumber: String(eventRow[WE_COL.MATCHED_TRANSACTION_NUMBER]),
      adminApprover: String(eventRow[WE_COL.ADMIN_APPROVER] || ''),
      approvalDate:  String(eventRow[WE_COL.APPROVAL_DATE] || ''),
      notes:         String(eventRow[WE_COL.NOTES] || ''),
    };

    return jsonOk(req.requestId, { event: updatedEvent });
  } catch (e: any) {
    return jsonError(req.requestId, 'INTERNAL_ERROR', String(e));
  }
}

function debugAdminCheck() {
  const raw = getConfigValue('AdminEmails');
  console.log('Raw AdminEmails value:', JSON.stringify(raw));
  const list = raw.split(',').map(e => e.trim().toLowerCase()).filter(Boolean);
  console.log('Parsed list:', list);
  console.log('Includes admin@mmrunners.org:', list.includes('admin@mmrunners.org'));
}


(globalThis as any).getPendingEvents     = getPendingEvents;
(globalThis as any).getUnmatchedPayments = getUnmatchedPayments;
(globalThis as any).getConfig            = getConfig;
(globalThis as any).updateConfigEntry    = updateConfigEntry;
(globalThis as any).getPaymentProofs     = getPaymentProofs;
(globalThis as any).getPublicConfig      = getPublicConfig;
(globalThis as any).manualMatch          = manualMatch;

