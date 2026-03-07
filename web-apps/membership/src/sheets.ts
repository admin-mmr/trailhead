// ============================================================
// Low-level sheet read/write helpers
// Depends on: config.ts, types.ts
// ============================================================

// ---- ID generators ----

function generateEventID(): string {
  return `EV-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
}

function generatePaymentID(): string {
  return `PY-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
}

function generateLogID(): string {
  return `LG-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
}

function generateMasterLogID(): string {
  return `ML-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
}

// ---- Membership Master ----

// Returns 'active' or 'inactive' based on expiration date.
// 'pending_upgrade' is STORED in the Status column and read directly by rowToMember — not derived.
function deriveStatus(expirationStr: string): 'active' | 'inactive' {
  if (!expirationStr || expirationStr.trim() === '') return 'inactive';
  const exp = new Date(expirationStr);
  if (isNaN(exp.getTime())) return 'inactive';
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return exp >= today ? 'active' : 'inactive';
}

function rowToMember(row: any[]): Member {
  const expiration = String(row[MM_COL.EXPIRATION] ?? '');
  const storedStatus = String(row[MM_COL.STATUS] ?? '').trim().toLowerCase();

  // 'pending_upgrade' is stored explicitly. For all other values (including legacy
  // 'expired', 'not active'), derive active/inactive from the expiration date.
  const status: Member['status'] =
    storedStatus === 'pending_upgrade'
      ? 'pending_upgrade'
      : deriveStatus(expiration);

  return {
    memberID: String(row[MM_COL.MEMBER_ID] ?? ''),
    status,
    created: String(row[MM_COL.CREATED] ?? ''),
    expiration,
    email: String(row[MM_COL.EMAIL] ?? ''),
    firstName: String(row[MM_COL.FIRST_NAME] ?? ''),
    lastName: String(row[MM_COL.LAST_NAME] ?? ''),
    type: String(row[MM_COL.TYPE] ?? 'Individual') as Member['type'],
    familyID: String(row[MM_COL.FAMILY_ID] ?? ''),
    gender: String(row[MM_COL.GENDER] ?? ''),
    wechatID: String(row[MM_COL.WECHAT_ID] ?? ''),
    district: String(row[MM_COL.DISTRICT] ?? ''),
    webApp: String(row[MM_COL.WEBAPP] ?? ''),
    paymentCheck: String(row[MM_COL.PAYMENT_CHECK] ?? ''),
    info: String(row[MM_COL.INFO] ?? ''),
    lastUpdated: String(row[MM_COL.LAST_UPDATED] ?? ''),
    membershipFeePaid: String(row[MM_COL.MEMBERSHIP_FEE_PAID] ?? ''),
    paymentDate: String(row[MM_COL.PAYMENT_DATE] ?? ''),
    paymentTransaction: String(row[MM_COL.PAYMENT_TRANSACTION] ?? ''),
    joinYear: String(row[MM_COL.JOIN_YEAR] ?? ''),
    phoneNumber: String(row[MM_COL.PHONE_NUMBER] ?? ''),
    lastLoginDate: String(row[MM_COL.LAST_LOGIN_DATE] ?? ''),
    profileLastUpdated: String(row[MM_COL.PROFILE_LAST_UPDATED] ?? ''),
    notes: String(row[MM_COL.NOTES] ?? ''),
  };
}

// ---- Membership-Master-Log (audit trail) ----

/**
 * Copy the current Main table row for memberID into the Log table BEFORE any write.
 * Rule: every function that updates Membership Master must call this first.
 */
function logMainTableRow(memberID: string): void {
  try {
    const mainSheet = getSheet(SHEET_NAMES.MEMBERSHIP_MASTER);
    const data = mainSheet.getDataRange().getValues();

    for (let i = 1; i < data.length; i++) {
      if (String(data[i][MM_COL.MEMBER_ID]) === memberID) {
        const logSheet = getSheet(SHEET_NAMES.MEMBERSHIP_LOG);
        const logRow = [
          generateMasterLogID(),
          new Date().toISOString(),
          ...data[i],            // All Main table columns verbatim
        ];
        logSheet.appendRow(logRow);
        return;
      }
    }
    // If member not found, log a warning but don't throw — write must proceed
    console.warn(`[logMainTableRow] memberID not found: ${memberID}`);
  } catch (e) {
    // Logging must never crash the main flow
    console.error('[logMainTableRow] failed:', e);
  }
}

function findMemberByEmail(email: string): { member: Member; rowIndex: number } | null {
  const sheet = getSheet(SHEET_NAMES.MEMBERSHIP_MASTER);
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][MM_COL.EMAIL]).toLowerCase() === email.toLowerCase()) {
      return { member: rowToMember(data[i]), rowIndex: i + 1 };
    }
  }
  return null;
}

function findMemberByID(memberID: string): { member: Member; rowIndex: number } | null {
  const sheet = getSheet(SHEET_NAMES.MEMBERSHIP_MASTER);
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][MM_COL.MEMBER_ID]) === memberID) {
      return { member: rowToMember(data[i]), rowIndex: i + 1 };
    }
  }
  return null;
}

function findMembersByFamilyID(familyID: string): Array<{ member: Member; rowIndex: number }> {
  const sheet = getSheet(SHEET_NAMES.MEMBERSHIP_MASTER);
  const data = sheet.getDataRange().getValues();
  const results: Array<{ member: Member; rowIndex: number }> = [];
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][MM_COL.FAMILY_ID]) === familyID) {
      results.push({ member: rowToMember(data[i]), rowIndex: i + 1 });
    }
  }
  return results;
}

function generateMemberID(): string {
  const sheet = getSheet(SHEET_NAMES.MEMBERSHIP_MASTER);
  const data = sheet.getDataRange().getValues();
  const used = new Set<number>();
  for (let i = 1; i < data.length; i++) {
    const m = String(data[i][MM_COL.MEMBER_ID]).match(/^A(\d{4})$/);
    if (m) used.add(parseInt(m[1], 10));
  }
  for (let n = 1; n <= 9999; n++) {
    if (!used.has(n)) return 'A' + String(n).padStart(4, '0');
  }
  throw new Error('No available member IDs (A0001–A9999 all in use).');
}

function generateFamilyID(): string {
  const sheet = getSheet(SHEET_NAMES.MEMBERSHIP_MASTER);
  const data = sheet.getDataRange().getValues();
  const used = new Set<number>();
  for (let i = 1; i < data.length; i++) {
    const m = String(data[i][MM_COL.FAMILY_ID]).match(/^B(\d{3})$/);
    if (m) used.add(parseInt(m[1], 10));
  }
  for (let n = 1; n <= 999; n++) {
    if (!used.has(n)) return 'B' + String(n).padStart(3, '0');
  }
  throw new Error('No available family IDs B001–B999 all in use.');
}

// Returns all members sharing a FamilyID
function getMembersByFamilyID(familyID: string): Member[] {
  const sheet = getSheet(SHEET_NAMES.MEMBERSHIP_MASTER);
  if (!sheet) return [];
  const rows = sheet.getDataRange().getValues();
  return rows.slice(1)
    .filter(row => String(row[MM_COL.FAMILY_ID]).trim() === familyID.trim())
    .map(row => rowToMember(row));
}


// ── PROTECTED: Direct row update (internal only, must be called via updateMemberWithLog) ──
function updateMemberRow(rowIndex: number, updates: Record<string, any>): void {
  const sheet = getSheet(SHEET_NAMES.MEMBERSHIP_MASTER);
  for (const [colKey, value] of Object.entries(updates)) {
    const colIndex = (MM_COL as Record<string, number>)[colKey];
    if (colIndex !== undefined) {
      sheet.getRange(rowIndex, colIndex + 1).setValue(value);
    }
  }
}

// ── PUBLIC: Update member with automatic logging (enforces audit trail) ──
function updateMemberWithLog(memberID: string, updates: Record<string, any>): void {
  // STEP 1: Log the current state before making any changes
  logMainTableRow(memberID);

  // STEP 2: Find the row and update it
  const result = findMemberByID(memberID);
  if (!result) {
    throw new Error(`[updateMemberWithLog] Member not found: ${memberID}`);
  }

  updateMemberRow(result.rowIndex, updates);
  console.log('[sheets] updated member:', memberID, 'with:', Object.keys(updates).join(', '));
}

// ---- WebApp-Events ----

function rowToWebAppEvent(row: any[]): WebAppEvent {
  return {
    eventID:                  String(row[WE_COL.EVENT_ID]                  ?? ''),
    eventType:                String(row[WE_COL.EVENT_TYPE]                ?? '') as WebAppEvent['eventType'],
    timestamp:                String(row[WE_COL.TIMESTAMP]                 ?? ''),
    expiresAt:                String(row[WE_COL.EXPIRES_AT]                ?? ''),
    memberID:                 String(row[WE_COL.MEMBER_ID]                 ?? ''),
    email:                    String(row[WE_COL.EMAIL]                     ?? ''),
    paymentIntent:            String(row[WE_COL.PAYMENT_INTENT]            ?? '') as WebAppEvent['paymentIntent'],
    amount:                   Number(row[WE_COL.AMOUNT]                    ?? 0),
    paymentMethod:            String(row[WE_COL.PAYMENT_METHOD]            ?? ''),
    payerName:                String(row[WE_COL.PAYER_NAME]                ?? ''),
    memoField:                String(row[WE_COL.MEMO_FIELD]                ?? ''),
    last4Digits:              String(row[WE_COL.LAST_4_DIGITS]             ?? ''),
    familyMemberEmails:       String(row[WE_COL.FAMILY_MEMBER_EMAILS]      ?? ''),
    status:                   String(row[WE_COL.STATUS]                    ?? '') as WebAppEvent['status'],
    matchedMessageId:         String(row[WE_COL.MATCHED_MESSAGE_ID]        ?? ''),
    matchedTransactionNumber: String(row[WE_COL.MATCHED_TRANSACTION_NUMBER]?? ''),
    adminApprover:            String(row[WE_COL.ADMIN_APPROVER]            ?? ''),
    approvalDate:             String(row[WE_COL.APPROVAL_DATE]             ?? ''),
    notes:                    String(row[WE_COL.NOTES]                     ?? ''),
    paymentDate:              String(row[WE_COL.PAYMENT_DATE]              ?? ''),
    screenshotFileId:         String(row[WE_COL.SCREENSHOT_FILE_ID]        ?? ''),
    gdriveFilePath:           String(row[WE_COL.GDRIVE_FILE_PATH]          ?? ''),
    ocrText:                  String(row[WE_COL.OCR_TEXT]                  ?? ''),
    ocrTimestamp:             String(row[WE_COL.OCR_TIMESTAMP]             ?? ''),
  };
}

function appendWebAppEvent(event: Omit<WebAppEvent, 'eventID'>): string {
  const sheet = getSheet(SHEET_NAMES.WEBAPP_EVENTS);
  const eventID = generateEventID();
  sheet.appendRow([
    eventID,
    event.eventType,
    event.timestamp,
    event.expiresAt,
    event.memberID,
    event.email,
    event.paymentIntent,
    event.amount,
    event.paymentMethod,
    event.payerName,
    event.memoField,
    event.last4Digits,
    event.familyMemberEmails,
    event.status,
    '', '', '', '', '',             // MatchedMessageId … Notes
    event.paymentDate      ?? '',
    event.screenshotFileId ?? '',
    event.gdriveFilePath   ?? '',
    event.ocrText          ?? '',
    event.ocrTimestamp     ?? '',
  ]);
  return eventID;
}

function findWebAppEvent(eventID: string): { event: WebAppEvent; rowIndex: number } | null {
  const sheet = getSheet(SHEET_NAMES.WEBAPP_EVENTS);
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][WE_COL.EVENT_ID]) === eventID) {
      return { event: rowToWebAppEvent(data[i]), rowIndex: i + 1 };
    }
  }
  return null;
}

function getPendingWebAppEvents(): WebAppEvent[] {
  const sheet = getSheet(SHEET_NAMES.WEBAPP_EVENTS);
  const data = sheet.getDataRange().getValues();
  const events: WebAppEvent[] = [];
  for (let i = 1; i < data.length; i++) {
    const status = String(data[i][WE_COL.STATUS]);
    if (status === 'Pending' || status === 'Matched') {
      events.push(rowToWebAppEvent(data[i]));
    }
  }
  return events;
}

// Returns all pending payment-type events for a specific member.
// Used by the dashboard to determine catch-all gate state.
function getPendingPaymentEventsForMember(memberID: string): WebAppEvent[] {
  const PAYMENT_TYPES: Set<string> = new Set([
    'dues_payment', 'family_switch', 'family_upgrade',
  ]);
  const sheet = getSheet(SHEET_NAMES.WEBAPP_EVENTS);
  const data = sheet.getDataRange().getValues();
  const events: WebAppEvent[] = [];
  for (let i = 1; i < data.length; i++) {
    if (
      String(data[i][WE_COL.MEMBER_ID]) === memberID &&
      String(data[i][WE_COL.STATUS]) === 'Pending' &&
      PAYMENT_TYPES.has(String(data[i][WE_COL.EVENT_TYPE]))
    ) {
      events.push(rowToWebAppEvent(data[i]));
    }
  }
  return events;
}

function updateWebAppEventRow(rowIndex: number, updates: Record<string, any>): void {
  const sheet = getSheet(SHEET_NAMES.WEBAPP_EVENTS);
  for (const [colKey, value] of Object.entries(updates)) {
    const colIndex = (WE_COL as Record<string, number>)[colKey];
    if (colIndex !== undefined) {
      sheet.getRange(rowIndex, colIndex + 1).setValue(value);
    }
  }
}

// ---- Payment-History ----

function appendPaymentRecord(record: Omit<PaymentRecord, 'paymentID'>): string {
  const sheet = getSheet(SHEET_NAMES.PAYMENT_HISTORY);
  const paymentID = generatePaymentID();
  sheet.appendRow([
    paymentID,
    record.eventID,
    record.memberID,
    record.paymentDate,
    record.amount,
    record.paymentIntent,
    record.paymentMethod,
    record.payerName,
    record.memoField,
    record.last4Digits,
    record.transactionReference,
    record.periodStart,
    record.periodEnd,
    record.processedBy,
    record.processedDate,
    record.source,
    record.notes,
  ]);
  return paymentID;
}

// ---- Fetch Gmail ----

function getUnmatchedGmailPayments(): FetchGmailRow[] {
  const sheet = getSheet(SHEET_NAMES.FETCH_GMAIL);
  const data = sheet.getDataRange().getValues();
  const results: FetchGmailRow[] = [];
  for (let i = 1; i < data.length; i++) {
    const processed = data[i][FG_COL.PROCESSED];
    if (!processed || String(processed).toUpperCase() === 'FALSE') {
      results.push(rowToFetchGmailRow(data[i], i + 1));
    }
  }
  return results;
}

function rowToFetchGmailRow(row: any[], rowIndex: number): FetchGmailRow {
  return {
    timestamp: String(row[FG_COL.TIMESTAMP] ?? ''),
    sender: String(row[FG_COL.SENDER] ?? ''),
    amount: Number(row[FG_COL.AMOUNT] ?? 0),
    memo: String(row[FG_COL.MEMO] ?? ''),
    transactionDate: String(row[FG_COL.TRANSACTION_DATE] ?? ''),
    transactionNumber: String(row[FG_COL.TRANSACTION_NUMBER] ?? ''),
    messageId: String(row[FG_COL.MESSAGE_ID] ?? ''),
    subject: String(row[FG_COL.SUBJECT] ?? ''),
    originalMemo: String(row[FG_COL.ORIGINAL_MEMO] ?? ''),
    notes: String(row[FG_COL.NOTES] ?? ''),
    processed: Boolean(row[FG_COL.PROCESSED]),
    source: String(row[FG_COL.SOURCE] ?? ''),
    webAppEventID: String(row[FG_COL.WEBAPP_EVENT_ID] ?? ''),
    rowIndex,
  };
}

function markGmailPaymentProcessed(rowIndex: number, eventID: string): void {
  const sheet = getSheet(SHEET_NAMES.FETCH_GMAIL);
  sheet.getRange(rowIndex, FG_COL.PROCESSED + 1).setValue(new Date().toISOString());
  sheet.getRange(rowIndex, FG_COL.WEBAPP_EVENT_ID + 1).setValue(eventID);
}


function getPaymentHistoryByMemberID(memberID: string): PaymentHistoryItem[] {
  const sheet = getSheet(SHEET_NAMES.PAYMENT_HISTORY);
  if (!sheet) return [];

  const rows = sheet.getDataRange().getValues();
  const headers = rows[0];
  const col = (name: string) => headers.indexOf(name);

  return rows.slice(1)
    .filter(row => row[col('MemberID')] === memberID)
    .map(row => ({
      paymentID:     String(row[col('PaymentID')]     || ''),
      eventID:       String(row[col('EventID')]       || ''),
      paymentDate:   String(row[col('PaymentDate')]   || ''),
      amount:        Number(row[col('Amount')]        || 0),
      paymentIntent: String(row[col('PaymentIntent')] || '') as PaymentHistoryItem['paymentIntent'],
      paymentMethod: String(row[col('PaymentMethod')] || ''),
      payerName:     String(row[col('PayerName')]     || ''),
      periodStart:   String(row[col('PeriodStart')]   || ''),
      periodEnd:     String(row[col('PeriodEnd')]     || ''),
      source:        String(row[col('Source')]        || ''),
      notes:         String(row[col('Notes')]         || ''),
      memoField:     String(row[col('MemoField')]    || ''),
    }));
}

function getWebAppEventsByMemberID(memberID: string): WebAppEventSummary[] {
  const sheet = getSheet(SHEET_NAMES.WEBAPP_EVENTS);
  if (!sheet) return [];

  const rows = sheet.getDataRange().getValues();
  const headers = rows[0];
  const col = (name: string) => headers.indexOf(name);

  return rows.slice(1)
    .filter(row => row[col('MemberID')] === memberID)
    .map(row => ({
      eventID:          String(row[col('EventID')]          || ''),
      eventType:        String(row[col('EventType')]        || ''),
      timestamp:        String(row[col('Timestamp')]        || ''),
      paymentIntent:    String(row[col('PaymentIntent')]    || ''),
      amount:           Number(row[col('Amount')]           || 0),
      paymentMethod:    String(row[col('PaymentMethod')]    || ''),
      status:           String(row[col('Status')]           || '') as WebAppEventSummary['status'],
      notes:            String(row[col('Notes')]            || ''),
      memoField:        String(row[col('MemoField')]       || ''),
      paymentDate:      String(row[col('PaymentDate')]      || ''),
      screenshotFileId: String(row[col('ScreenshotFileId')] || ''),
      gdriveFilePath:   String(row[col('GDriveFilePath')]   || ''),
      ocrText:          String(row[col('OCRText')]          || ''),
      ocrTimestamp:     String(row[col('OCRTimestamp')]     || ''),
    }));
}

// ── globalThis exports for test environment ──────────────────
(globalThis as any).deriveStatus                   = deriveStatus;
(globalThis as any).rowToMember                    = rowToMember;
(globalThis as any).logMainTableRow                = logMainTableRow;
(globalThis as any).findMemberByEmail              = findMemberByEmail;
(globalThis as any).findMemberByID                 = findMemberByID;
(globalThis as any).findMembersByFamilyID          = findMembersByFamilyID;
(globalThis as any).getMembersByFamilyID           = getMembersByFamilyID;
(globalThis as any).generateMemberID               = generateMemberID;
(globalThis as any).generateFamilyID               = generateFamilyID;
(globalThis as any).generateMasterLogID            = generateMasterLogID;
(globalThis as any).updateMemberWithLog           = updateMemberWithLog;  // ENFORCED: All updates must log first
(globalThis as any).appendWebAppEvent              = appendWebAppEvent;
(globalThis as any).findWebAppEvent                = findWebAppEvent;
(globalThis as any).getPendingWebAppEvents         = getPendingWebAppEvents;
(globalThis as any).getPendingPaymentEventsForMember = getPendingPaymentEventsForMember;
(globalThis as any).updateWebAppEventRow           = updateWebAppEventRow;
(globalThis as any).appendPaymentRecord            = appendPaymentRecord;
(globalThis as any).getUnmatchedGmailPayments      = getUnmatchedGmailPayments;
(globalThis as any).markGmailPaymentProcessed      = markGmailPaymentProcessed;
(globalThis as any).getPaymentHistoryByMemberID    = getPaymentHistoryByMemberID;
(globalThis as any).getWebAppEventsByMemberID      = getWebAppEventsByMemberID;
(globalThis as any).generateEventID             = generateEventID;
(globalThis as any).generatePaymentID           = generatePaymentID;
(globalThis as any).generateLogID               = generateLogID;
(globalThis as any).updateMemberRow             = updateMemberRow;
