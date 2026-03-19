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
  const req = JSON.parse(jsonRequest) as ApiRequest<{ adminEmail: string; caller?: string; sessionID?: string }>;
  const { payload } = req;
  try {
    console.log('[mmr][getConfig] called by:', payload.caller || 'unknown', '| adminEmail:', payload.adminEmail);
    if (!isAdmin(payload.adminEmail)) {
      console.log('[mmr][getConfig] FORBIDDEN for:', payload.adminEmail);
      auditLog('CONFIG_UNAUTHORIZED', { email: payload.adminEmail });
      return jsonError(req.requestId, 'FORBIDDEN', 'Not authorized.');
    }
    const config = getConfigMap();
    console.log('[mmr][getConfig] returning', Object.keys(config).length, 'config entries');
    auditLog('CONFIG_RETRIEVED', {
      email: payload.adminEmail,
      state: { configKeys: Object.keys(config).join(','), caller: payload.caller }
    });
    return jsonOk(req.requestId, { config });
  } catch (e: any) {
    console.error('[mmr][getConfig] error:', String(e));
    auditLog('CONFIG_ERROR', { email: payload.adminEmail, errorMessage: String(e) });
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
  const req = JSON.parse(jsonRequest) as ApiRequest<{ sessionID?: string }>;
  const { payload } = req;
  try {
    console.log('[mmr][getPublicConfig] called | requestId:', req.requestId);
    const allConfig = getConfigMap();
    console.log('[mmr][getPublicConfig] all config keys:', Object.keys(allConfig).length, 'entries');

    const publicConfig: Record<string, string> = {};
    const publicKeys = ['ZelleHandle','VenmoHandle','PayPalHandle',
                        'ZelleQRCodeFileId','VenmoQRCodeFileId',
                        'IndividualPrice','FamilyPrice','FamilyUpgradePrice','Districts'];
    for (const key of publicKeys) {
      const val = allConfig[key];
      console.log(`[mmr][getPublicConfig] key="${key}" value="${val ?? '(missing)'}" `);
      if (val) publicConfig[key] = val;
    }

    console.log('[mmr][getPublicConfig] returning keys:', Object.keys(publicConfig).join(','));
    auditLog('PUBLIC_CONFIG_RETRIEVED', {
      state: { configKeys: Object.keys(publicConfig).join(',') }
    });
    return jsonOk(req.requestId, { config: publicConfig });
  } catch (e: any) {
    console.error('[mmr][getPublicConfig] error:', String(e));
    auditLog('PUBLIC_CONFIG_ERROR', { errorMessage: String(e) });
    return jsonError(req.requestId, 'INTERNAL_ERROR', String(e));
  }
}

// ── initializeSessionConfig ────────────────────────────────────────────────
// Load publicConfig at login to populate sessionStorage cache across pages.
function initializeSessionConfig(jsonRequest: string): string {
  const req = JSON.parse(jsonRequest) as ApiRequest<{ sessionID?: string }>;
  try {
    console.log('[mmr][initializeSessionConfig] called');

    // Load config once
    const allConfig = getConfigMap();
    console.log('[mmr][initializeSessionConfig] config loaded:', Object.keys(allConfig).length, 'entries');

    // Extract public config keys
    const publicConfig: Record<string, string> = {};
    const publicKeys = ['ZelleHandle','VenmoHandle','PayPalHandle',
                        'ZelleQRCodeFileId','VenmoQRCodeFileId',
                        'IndividualPrice','FamilyPrice','FamilyUpgradePrice','Districts'];
    for (const key of publicKeys) {
      const val = allConfig[key];
      if (val) publicConfig[key] = val;
    }

    console.log('[mmr][initializeSessionConfig] returning:', Object.keys(publicConfig).join(','));
    auditLog('SESSION_CONFIG_INITIALIZED', {
      state: { publicKeys: Object.keys(publicConfig).join(',') }
    });
    return jsonOk(req.requestId, { config: publicConfig });
  } catch (e: any) {
    console.error('[mmr][initializeSessionConfig] error:', String(e));
    auditLog('SESSION_CONFIG_ERROR', { errorMessage: String(e) });
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
      expiresAt:      String(eventRow[WE_COL.EXPIRES_AT] || ''),
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

// ── getMemberSummaryForAdmin ─────────────────────────────────
// Returns key member info (type, expiration, status) for admin preview
// before creating a payment proof record on behalf of a member.
function getMemberSummaryForAdmin(jsonRequest: string): string {
  const req = JSON.parse(jsonRequest) as ApiRequest<{ adminEmail: string; memberID: string }>;
  const { payload } = req;
  try {
    if (!isAdmin(payload.adminEmail)) {
      return jsonError(req.requestId, 'FORBIDDEN', 'Not authorized.');
    }

    const memberID = (payload.memberID || '').trim();
    if (!memberID) {
      return jsonError(req.requestId, 'BAD_REQUEST', 'memberID is required.');
    }

    const result = findMemberByID(memberID);
    if (!result) {
      return jsonError(req.requestId, 'NOT_FOUND', `Member not found: ${memberID}`);
    }

    const m = result.member;
    console.log('[mmr][getMemberSummaryForAdmin] found member:', m.memberID, 'type:', m.type, 'exp:', m.expiration);

    return jsonOk(req.requestId, {
      memberID: m.memberID,
      firstName: m.firstName,
      lastName: m.lastName,
      email: m.email,
      type: m.type,
      expiration: m.expiration,
      status: m.status,
    });
  } catch (e: any) {
    console.error('[mmr][getMemberSummaryForAdmin] error:', String(e));
    return jsonError(req.requestId, 'INTERNAL_ERROR', String(e));
  }
}

// ── adminCreatePaymentProof ──────────────────────────────────
// Creates a WebApp-Events row (PaymentProof / Matched) on behalf of a member,
// linking it to the unmatched Gmail payment and marking that row processed.
function adminCreatePaymentProof(jsonRequest: string): string {
  const req = JSON.parse(jsonRequest) as ApiRequest<{
    adminEmail: string;
    memberID: string;
    paymentIntent: string;
    messageId: string;
    transactionNumber: string;
    amount: number;
    sender: string;
    memo: string;
    source: string;
    transactionDate: string;
    rowIndex: number;
  }>;
  const { payload } = req;

  try {
    if (!isAdmin(payload.adminEmail)) {
      return jsonError(req.requestId, 'FORBIDDEN', 'Not authorized.');
    }

    const memberID = (payload.memberID || '').trim();
    if (!memberID) {
      return jsonError(req.requestId, 'BAD_REQUEST', 'memberID is required.');
    }

    const result = findMemberByID(memberID);
    if (!result) {
      return jsonError(req.requestId, 'NOT_FOUND', `Member not found: ${memberID}`);
    }

    const m = result.member;
    const now = new Date().toISOString();

    // Create the proof event with Approved status (admin-created, fully reviewed)
    const paymentIntent = (payload.paymentIntent || 'Individual Membership').trim() as WebAppEvent['paymentIntent'];
    const newEventID = appendWebAppEvent({
      eventType: 'PaymentProof',
      timestamp: now,
      expiresAt: '',
      memberID: m.memberID,
      email: m.email,
      paymentIntent,
      amount: Number(payload.amount) || 0,
      paymentMethod: payload.source || '',
      payerName: payload.sender || '',
      memoField: payload.memo || '',
      last4Digits: '',
      familyMemberEmails: '',
      status: 'Approved',
      matchedMessageId: payload.messageId || '',
      matchedTransactionNumber: payload.transactionNumber || '',
      adminApprover: payload.adminEmail,
      approvalDate: now,
      notes: `Created & approved by admin ${payload.adminEmail} on ${now} from unmatched payment (${paymentIntent})`,
      paymentDate: payload.transactionDate || '',
      screenshotFileId: '',
      gdriveFilePath: '',
      ocrText: '',
      ocrTimestamp: '',
    });

    console.log('[mmr][adminCreatePaymentProof] created eventID:', newEventID, 'for member:', memberID, 'intent:', paymentIntent);

    // ── CREATE PAYMENT-HISTORY RECORD (required for audit trail) ──
    const paymentID = appendPaymentRecord({
      eventID: newEventID,
      memberID: m.memberID,
      paymentDate: payload.transactionDate || now.split('T')[0],
      amount: Number(payload.amount) || 0,
      paymentIntent,
      paymentMethod: payload.source || '',
      payerName: payload.sender || '',
      memoField: payload.memo || '',
      last4Digits: '',
      transactionReference: payload.transactionNumber || '',
      periodStart: '',
      periodEnd: '',
      processedBy: payload.adminEmail,
      processedDate: now,
      source: 'Admin-Created',
      notes: `Created from unmatched payment by admin ${payload.adminEmail}`,
    });
    console.log('[mmr][adminCreatePaymentProof] created payment record:', paymentID);

    // Mark the Fetch-Gmail row as processed if rowIndex was provided
    if (payload.rowIndex && Number(payload.rowIndex) > 0) {
      markGmailPaymentProcessed(Number(payload.rowIndex), newEventID);
      console.log('[mmr][adminCreatePaymentProof] marked Gmail row processed, rowIndex:', payload.rowIndex);
    }

    auditLog('ADMIN_CREATE_PAYMENT_PROOF', {
      email: payload.adminEmail,
      memberID,
      state: {
        eventID: newEventID,
        messageId: payload.messageId,
        amount: payload.amount,
        sender: payload.sender,
        paymentIntent,
      },
    });

    // Send approval email to member (status is Approved immediately)
    notifyPaymentApproved(memberID, paymentIntent);

    return jsonOk(req.requestId, { eventID: newEventID });
  } catch (e: any) {
    console.error('[mmr][adminCreatePaymentProof] error:', String(e));
    return jsonError(req.requestId, 'INTERNAL_ERROR', String(e));
  }
}

// ── Composite endpoints ────────────────────────────────────────────────────
// These combine multiple data fetches into a SINGLE GAS execution so the
// config sheet is read only once and the frontend makes one round-trip
// instead of 3-4 separate google.script.run calls.
// ────────────────────────────────────────────────────────────────────────────

function loadDashboardData(jsonRequest: string): string {
  const req = JSON.parse(jsonRequest) as ApiRequest<{ email: string; sessionID?: string }>;
  const { payload } = req;
  try {
    const email = (payload.email || '').trim().toLowerCase();
    console.log('[mmr][loadDashboardData] called | email:', email);

    if (!email) {
      return jsonError(req.requestId, 'AUTH_REQUIRED', 'No email available. Please sign in again.');
    }

    // 1. Load config ONCE (all subsequent getConfigValue calls within this
    //    execution will hit the in-memory cache)
    const allConfig = getConfigMap();
    console.log('[mmr][loadDashboardData] config loaded:', Object.keys(allConfig).length, 'entries');

    // 2. Extract public config
    const publicConfig: Record<string, string> = {};
    const publicKeys = ['ZelleHandle','VenmoHandle','PayPalHandle',
                        'ZelleQRCodeFileId','VenmoQRCodeFileId',
                        'IndividualPrice','FamilyPrice','FamilyUpgradePrice','Districts'];
    for (const key of publicKeys) {
      const val = allConfig[key];
      if (val) publicConfig[key] = val;
    }

    // 3. Resolve member
    const found = findMemberByEmail(email);
    if (!found) {
      console.log('[mmr][loadDashboardData] member not found for:', email);
      return jsonError(req.requestId, 'NOT_FOUND', 'Member not found. Please sign in again.');
    }
    const member = found.member;
    console.log('[mmr][loadDashboardData] member found:', member.memberID, '| status:', member.status);

    // 4. Family members
    let familyMembers: Member[] = [];
    if (member.familyID) {
      familyMembers = findMembersByFamilyID(member.familyID).map(r => r.member);
    }

    // 5. Payment history + events (expand to family scope)
    let allMemberIDs: string[] = [member.memberID];
    if (member.familyID) {
      const fam = getMembersByFamilyID(member.familyID);
      const famIDs = fam.map((m: Member) => m.memberID).filter((id: string) => id !== member.memberID);
      allMemberIDs = [member.memberID, ...famIDs];
    }

    const payments = allMemberIDs.flatMap(id => getPaymentHistoryByMemberID(id));
    const events   = allMemberIDs.flatMap(id => getWebAppEventsByMemberID(id));

    const PAYMENT_TYPES = ['dues_payment', 'family_switch', 'family_upgrade', 'PaymentProof'];
    const pendingPayments = events.filter(e => PAYMENT_TYPES.includes(e.eventType) && e.status === 'Pending');

    console.log('[mmr][loadDashboardData] payments:', payments.length, '| events:', events.length, '| pending:', pendingPayments.length);

    // 6. Admin check (uses same in-memory config — no extra sheet read)
    const adminEmails = (allConfig['AdminEmails'] || '')
      .split(',')
      .map((e: string) => e.trim().toLowerCase())
      .filter(Boolean);
    const isUserAdmin = adminEmails.includes(email);
    console.log('[mmr][loadDashboardData] isAdmin:', isUserAdmin);

    auditLog('DASHBOARD_DATA_LOADED', {
      memberID: member.memberID,
      state: { payments: payments.length, events: events.length, isAdmin: isUserAdmin }
    });

    return jsonOk(req.requestId, {
      member,
      familyMembers,
      config: publicConfig,
      events,
      pendingPaymentCount: pendingPayments.length,
      isAdmin: isUserAdmin,
    });
  } catch (e: any) {
    console.error('[mmr][loadDashboardData] error:', String(e));
    return jsonError(req.requestId, 'INTERNAL_ERROR', String(e));
  }
}


function loadProfileData(jsonRequest: string): string {
  const req = JSON.parse(jsonRequest) as ApiRequest<{ email: string; sessionID?: string }>;
  const { payload } = req;
  try {
    const email = (payload.email || '').trim().toLowerCase();
    console.log('[mmr][loadProfileData] called | email:', email);

    if (!email) {
      return jsonError(req.requestId, 'AUTH_REQUIRED', 'No email available. Please sign in again.');
    }

    // 1. Load config ONCE
    const allConfig = getConfigMap();

    // 2. Extract public config
    const publicConfig: Record<string, string> = {};
    const publicKeys = ['ZelleHandle','VenmoHandle','PayPalHandle',
                        'ZelleQRCodeFileId','VenmoQRCodeFileId',
                        'IndividualPrice','FamilyPrice','FamilyUpgradePrice','Districts'];
    for (const key of publicKeys) {
      const val = allConfig[key];
      if (val) publicConfig[key] = val;
    }

    // 3. Resolve member
    const found = findMemberByEmail(email);
    if (!found) {
      console.log('[mmr][loadProfileData] member not found for:', email);
      return jsonError(req.requestId, 'NOT_FOUND', 'Member not found. Please sign in again.');
    }

    console.log('[mmr][loadProfileData] member found:', found.member.memberID, '| Districts:', publicConfig['Districts'] ? 'present' : 'missing');

    auditLog('PROFILE_DATA_LOADED', { memberID: found.member.memberID });

    return jsonOk(req.requestId, {
      member: found.member,
      config: publicConfig,
    });
  } catch (e: any) {
    console.error('[mmr][loadProfileData] error:', String(e));
    return jsonError(req.requestId, 'INTERNAL_ERROR', String(e));
  }
}


(globalThis as any).getPendingEvents           = getPendingEvents;
(globalThis as any).getUnmatchedPayments      = getUnmatchedPayments;
(globalThis as any).getConfig                 = getConfig;
(globalThis as any).updateConfigEntry         = updateConfigEntry;
(globalThis as any).getPaymentProofs          = getPaymentProofs;
(globalThis as any).getPublicConfig           = getPublicConfig;
(globalThis as any).initializeSessionConfig   = initializeSessionConfig;
(globalThis as any).manualMatch               = manualMatch;
(globalThis as any).getMemberSummaryForAdmin  = getMemberSummaryForAdmin;
(globalThis as any).adminCreatePaymentProof   = adminCreatePaymentProof;
(globalThis as any).loadDashboardData         = loadDashboardData;
(globalThis as any).loadProfileData           = loadProfileData;

