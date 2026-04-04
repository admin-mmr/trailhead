// ============================================================
// Spreadsheet configuration
// MEMBERSHIP_SPREADSHEET_ID: the workbook containing Membership-Master-Main-3
//   and all new sheets (WebApp-Events, Payment-History, Auth-OTP, Config,
//   WebApp-ActivityLog, Membership-Master-Log).
// GMAIL_SPREADSHEET_ID: the separate workbook containing the Fetch-Gmail sheet.
// Update both IDs before deploying.
// ============================================================

const MEMBERSHIP_SPREADSHEET_ID = '11SFvgApmDtEv4jz5bTYI9_zEhCFMQAXC4b2z_4s3ljk';
const GMAIL_SPREADSHEET_ID = '1rVOvhXzSxCRpWdAw3jYq5tWrYdCYtXmfqblTHP_wPqA';
const EMAIL_LOG_SHEET_ID = '1G0dr2vjW-vMN0UbpxvzdBajmFSQLsiRbLd1A-36xk0I';
const EMAIL_LOG_SHEET_NAME = 'Current';

// Sheet names
const SHEET_NAMES = {
  MEMBERSHIP_MASTER: 'Main',
  MEMBERSHIP_LOG:    'Membership-Master-Log',   // Full-row audit log (copy before every write)
  WEBAPP_EVENTS:     'WebApp-Events',
  PAYMENT_HISTORY:   'Payment-History',
  OTP:               'OTP',
  CONFIG:            'Config',
  ACTIVITY_LOG:      'WebApp-ActivityLog',
  FETCH_GMAIL:       'Active',
  PAYMENT_EVENTS:    'Payment Confirmation Events',
  OUTBOUND_EMAILS:   'Outbound-Emails',          // Log of all outbound reminder emails
  // MySQL sync destination tabs (same file)
  SQL_MEMBERS:       'SQL Members',
  SQL_PAYMENTS:      'SQL Payments',
  SQL_SUBMISSIONS:   'SQL Submissions',
};

// Sheets that live in the Fetch-Gmail spreadsheet (all others are in the membership spreadsheet)
const GMAIL_SHEETS = new Set([SHEET_NAMES.FETCH_GMAIL]);

// Membership Master column indices (0-based)
const MM_COL = {
  MEMBER_ID: 0,
  STATUS: 1,
  CREATED: 2,
  EXPIRATION: 3,
  EMAIL: 4,
  FIRST_NAME: 5,
  LAST_NAME: 6,
  TYPE: 7,
  FAMILY_ID: 8,
  GENDER: 9,
  WECHAT_ID: 10,
  DISTRICT: 11,
  INFO: 12,                // shifted −2 (WebApp + PaymentCheck removed)
  LAST_UPDATED: 13,
  MEMBERSHIP_FEE_PAID: 14,
  PAYMENT_DATE: 15,
  PAYMENT_TRANSACTION: 16,
  JOIN_YEAR: 17,
  PHONE_NUMBER: 18,
  LAST_LOGIN: 19,
  NOTES: 20,
  NYRR_RUNNER_NAME: 21,
  YEAR_BORN: 22,
  // Unix timestamp columns (for timezone-invariant sync)
  LAST_UPDATED_UNIX: 23,
  LAST_LOGIN_UNIX: 24,
  CREATED_UNIX: 25,
};

// Membership-Master-Log column indices (0-based)
// LogID and LoggingTime are prepended; all MM_COL values follow at offset +2
const ML_COL = {
  LOG_ID: 0,
  LOGGING_TIME: 1,
  // Main table columns start at index 2 (MM_COL offset by +2)
};
const ML_MM_OFFSET = 2; // MM columns start at this index in the log table

// WebApp-Events column indices (0-based)
const WE_COL = {
  EVENT_ID: 0,
  EVENT_TYPE: 1,
  TIMESTAMP: 2,
  EXPIRES_AT: 3,           // New: Timestamp + PaymentProofReviewDays
  MEMBER_ID: 4,
  EMAIL: 5,
  PAYMENT_INTENT: 6,
  AMOUNT: 7,
  PAYMENT_METHOD: 8,
  PAYER_NAME: 9,
  MEMO_FIELD: 10,
  LAST_4_DIGITS: 11,
  FAMILY_MEMBER_EMAILS: 12,
  STATUS: 13,
  MATCHED_MESSAGE_ID: 14,
  MATCHED_TRANSACTION_NUMBER: 15,
  ADMIN_APPROVER: 16,
  APPROVAL_DATE: 17,
  NOTES: 18,
  // Payment-proof fields
  PAYMENT_DATE: 19,
  SCREENSHOT_FILE_ID: 20,
  GDRIVE_FILE_PATH: 21,
  OCR_TEXT: 22,
  OCR_TIMESTAMP: 23,
  // Unix timestamp columns (for timezone-invariant sync)
  TIMESTAMP_UNIX: 24,
  EXPIRES_AT_UNIX: 25,
  APPROVAL_DATE_UNIX: 26,
};

// Payment-History column indices (0-based)
const PH_COL = {
  PAYMENT_ID: 0,
  EVENT_ID: 1,
  MEMBER_ID: 2,
  PAYMENT_DATE: 3,
  AMOUNT: 4,
  PAYMENT_INTENT: 5,
  PAYMENT_METHOD: 6,
  PAYER_NAME: 7,
  MEMO_FIELD: 8,
  LAST_4_DIGITS: 9,
  TRANSACTION_REFERENCE: 10,
  PERIOD_START: 11,
  PERIOD_END: 12,
  PROCESSED_BY: 13,
  PROCESSED_DATE: 14,
  SOURCE: 15,
  NOTES: 16,
  // Unix timestamp columns (for timezone-invariant sync)
  PROCESSED_DATE_UNIX: 17,
};

// Auth-OTP column indices (0-based)
const OTP_COL = {
  EMAIL: 0,
  OTP_CODE: 1,
  CREATED_AT: 2,
  EXPIRES_AT: 3,
  USED: 4,
  IP_ADDRESS: 5,
};

// WebApp-ActivityLog column indices (0-based)
const LOG_COL = {
  LOG_ID: 0,
  TIMESTAMP: 1,
  SESSION_ID: 2,
  MEMBER_ID: 3,
  EMAIL: 4,
  EVENT_ID: 5,
  ACTION: 6,
  STATE: 7,
  ERROR_CODE: 8,
  ERROR_MESSAGE: 9,
};

// Outbound-Emails column indices (0-based)
// Tracks every outbound reminder email for throttling and audit purposes.
const OE_COL = {
  LOG_ID:        0,  // e.g. OE-1234567890-1234
  TIMESTAMP:     1,  // ISO datetime sent
  MEMBER_ID:     2,
  EMAIL:         3,
  REMINDER_TYPE: 4,  // 'IncompleteSignup' | 'RenewalReminder'
  SUBJECT:       5,
  STATUS:        6,  // 'sent' | 'failed'
  NOTES:         7,
};

// Fetch Gmail column indices (0-based)
const FG_COL = {
  TIMESTAMP: 0,
  SENDER: 1,
  AMOUNT: 2,
  MEMO: 3,
  TRANSACTION_DATE: 4,
  TRANSACTION_NUMBER: 5,
  MESSAGE_ID: 6,
  SUBJECT: 7,
  ORIGINAL_MEMO: 8,
  NOTES: 9,
  PROCESSED: 10,
  SOURCE: 11,
  PAYMENT_ID: 12,
};

// Config sheet column indices (0-based)
const CFG_COL = {
  KEY: 0,
  VALUE: 1,
  DESCRIPTION: 2,
};

// Payment Confirmation Events column indices (0-based)
const PCE_COL = {
  EVENT_NAME: 0,
  DESCRIPTION: 1,
  CONFIRMATION_METHOD: 2,
};


// ============================================================
// Sheet headers for auto-creation (new sheets only)
// Existing sheets (Membership Master, Fetch-Gmail) must already exist.
// ============================================================

const SHEET_HEADERS: Record<string, string[]> = {
  [SHEET_NAMES.MEMBERSHIP_LOG]: [
    'LogID', 'LoggingTime',
    // All Main table columns follow (mirrors MM_COL order exactly — keep in sync)
    'MemberID', 'Status', 'Created', 'Expiration', 'Email',
    'FirstName', 'LastName', 'Type', 'FamilyID', 'Gender',
    'WeChatID', 'District', 'Info',
    'LastUpdated', 'MembershipFeePaid', 'PaymentDate', 'PaymentTransaction',
    'JoinYear', 'PhoneNumber', 'LastLogin', 'Notes',
    'NYRRRunnerName', 'YearBorn',
    'LastUpdatedUnix', 'LastLoginUnix', 'CreatedUnix',
  ],
  [SHEET_NAMES.WEBAPP_EVENTS]: [
    'EventID', 'EventType', 'Timestamp', 'ExpiresAt', 'MemberID', 'Email',
    'PaymentIntent', 'Amount', 'PaymentMethod', 'PayerName', 'MemoField',
    'Last4Digits', 'FamilyMemberEmails', 'Status',
    'MatchedMessageId', 'MatchedTransactionNumber',
    'AdminApprover', 'ApprovalDate', 'Notes',
    'PaymentDate', 'ScreenshotFileId', 'GDriveFilePath', 'OCRText', 'OCRTimestamp',
  ],
  [SHEET_NAMES.PAYMENT_HISTORY]: [
    'PaymentID', 'EventID', 'MemberID', 'PaymentDate', 'Amount',
    'PaymentIntent', 'PaymentMethod', 'PayerName', 'MemoField',
    'Last4Digits', 'TransactionReference', 'PeriodStart', 'PeriodEnd',
    'ProcessedBy', 'ProcessedDate', 'Source', 'Notes',
  ],
  [SHEET_NAMES.OTP]: [
    'Email', 'OTPCode', 'CreatedAt', 'ExpiresAt', 'Used', 'IPAddress',
  ],
  [SHEET_NAMES.CONFIG]: [
    'Key', 'Value', 'Description',
  ],
  [SHEET_NAMES.ACTIVITY_LOG]: [
    'LogID', 'Timestamp', 'SessionID', 'MemberID', 'Email',
    'EventID', 'Action', 'State', 'ErrorCode', 'ErrorMessage',
  ],
  [SHEET_NAMES.PAYMENT_EVENTS]: [
    'Event Name', 'Description', 'Confirmation Method',
  ],
  [SHEET_NAMES.OUTBOUND_EMAILS]: [
    'LogID', 'Timestamp', 'MemberID', 'Email',
    'ReminderType', 'Subject', 'Status', 'Notes',
  ],
};

// Default Config values seeded on first creation
const DEFAULT_CONFIG_ROWS: string[][] = [
  ['IndividualPrice',          '30',                      'Price for individual membership dues'],
  ['FamilyPrice',              '50',                      'Price for family membership dues'],
  ['FamilyUpgradePrice',       '20',                      'Delta price to upgrade Individual → Family mid-cycle'],
  ['PaymentMethods',           'Zelle,Venmo,PayPal',      'Comma-separated accepted payment methods'],
  ['Districts',                '',                        'Comma-separated list of member districts'],
  ['ZelleHandle',              'zelle@example.com',       'Zelle payment handle'],
  ['VenmoHandle',              '@venmo-user',             'Venmo payment handle'],
  ['PayPalHandle',             'paypal@example.com',      'PayPal payment handle'],
  ['ReminderDaysBefore',       '42',                      'Days before expiry to show renewal buttons on dashboard'],
  ['UpgradeMinMonths',         '3',                       'Minimum months remaining to allow Family Upgrade (delta payment)'],
  ['PaymentProofReviewDays',   '7',                       'Days before an unreviewed payment proof event auto-expires'],
  ['MembershipRenewalYears',   '1',                       'Years added per dues payment'],
  ['OTPValidHours',            '24',                      'Hours before OTP expires'],
  ['OTPCleanupDays',           '7',                       'Days before used/expired OTPs are deleted'],
  ['AdminEmails',              'admin@mmrunners.org',     'Comma-separated admin email addresses'],
  ['MembershipCollectionStart','',                        'First day of annual membership collection window (YYYY-MM-DD). Auto-guess matching only runs within this window.'],
  ['MembershipCollectionEnd',  '',                        'Last day of annual membership collection window (YYYY-MM-DD). Auto-guess matching only runs within this window.'],
  ['AppBaseUrl',               '',                        'Deployed web app URL (set after first deploy)'],
  ['PaymentProofFolderId',     '1I-FR4iTC8649XBzFSplyG2XARNBHwflz', 'Google Drive folder ID for payment proofs'],
  ['ZelleQRCodeFileId',        '',                        'Google Drive file ID for Zelle QR code image'],
  ['VenmoQRCodeFileId',        '',                        'Google Drive file ID for Venmo QR code image'],
];

// Default Payment Events values seeded on first creation
const DEFAULT_PAYMENT_EVENTS_ROWS: string[][] = [
  ['Individual Membership', 'Confirm your payment for individual membership dues', 'Match with payment history'],
  ['Family Membership',     'Confirm your payment for family membership dues',     'Match with payment history'],
  ['Family Upgrade',        'Confirm your payment for upgrading to family membership (delta)', 'Match with payment history'],
  ['Other Payment',         'Confirm your other payments related to membership',   'Manual review'],
];


// ============================================================
// Spreadsheet + Config helpers
// ============================================================

// Config caching — reduces repeated sheet reads during single GAS execution
// Only use global cache with TTL. Session-based caching is not effective
// because each page load creates a new sessionID and each google.script.run
// call is a separate GAS execution with fresh memory.
let configMapCache: ConfigMap | null = null;
let configCacheTime = 0;
const CONFIG_CACHE_TTL_MS = 60000; // 60 second cache per GAS execution

function getSheet(name: string): GoogleAppsScript.Spreadsheet.Sheet {
  const id = GMAIL_SHEETS.has(name) ? GMAIL_SPREADSHEET_ID : MEMBERSHIP_SPREADSHEET_ID;
  const ss = SpreadsheetApp.openById(id);
  let sheet = ss.getSheetByName(name);

  if (!sheet) {
    const headers = SHEET_HEADERS[name];
    if (!headers) {
      // Existing sheet (Membership Master or Fetch-Gmail) — must exist already
      throw new Error(`Sheet not found: "${name}" in spreadsheet ${id}`);
    }
    // Auto-create with correct headers
    sheet = ss.insertSheet(name);
    sheet.appendRow(headers);
    // Freeze header row
    sheet.setFrozenRows(1);
    // Seed default values
    if (name === SHEET_NAMES.CONFIG) {
      DEFAULT_CONFIG_ROWS.forEach(row => sheet!.appendRow(row));
    } else if (name === SHEET_NAMES.PAYMENT_EVENTS) {
      DEFAULT_PAYMENT_EVENTS_ROWS.forEach(row => sheet!.appendRow(row));
    }
  }

  return sheet;
}

/** Reset the in-process config cache. Call this in tests between seedings. */
function clearConfigCache(): void {
  configMapCache = null;
  configCacheTime = 0;
}

function getConfigMap(): ConfigMap {
  // Check global cache — reduces duplicate sheet reads during single GAS execution
  const now = Date.now();
  if (configMapCache !== null && (now - configCacheTime) < CONFIG_CACHE_TTL_MS) {
    console.log('[config] getConfigMap cache hit, skipping sheet read');
    return configMapCache;
  }

  // Cache miss — read from sheet
  console.log('[config] getConfigMap cache miss, reading from sheet');
  const sheet = getSheet(SHEET_NAMES.CONFIG);
  const rows = sheet.getDataRange().getValues();
  const map: ConfigMap = {};
  for (let i = 1; i < rows.length; i++) {
    const key = String(rows[i][CFG_COL.KEY]).trim();
    const value = String(rows[i][CFG_COL.VALUE]).trim();
    if (key) map[key] = value;
  }

  // Store in cache
  configMapCache = map;
  configCacheTime = now;

  console.log('[config] getConfigMap loaded', Object.keys(map).length, 'config entries');
  return map;
}

function getConfigValue(key: string): string {
  return getConfigMap()[key] ?? '';
}

function setConfigValue(key: string, value: string): void {
  const sheet = getSheet(SHEET_NAMES.CONFIG);
  const rows = sheet.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][CFG_COL.KEY]).trim() === key) {
      sheet.getRange(i + 1, CFG_COL.VALUE + 1).setValue(value);
      return;
    }
  }
  // Key not found — append new row
  sheet.appendRow([key, value, '']);
}

function getDistrictsFromConfig(jsonRequest: string): string {
  const req = JSON.parse(jsonRequest) as ApiRequest<{}>;
  try {
    const districtsStr = getConfigValue('Districts') || '';
    const districts = districtsStr
      .split(',')
      .map(d => d.trim())
      .filter(d => d.length > 0);

    console.log('[config] getDistrictsFromConfig found', districts.length, 'districts');
    return jsonOk(req.requestId, { districts });
  } catch (e: any) {
    console.error('[config] getDistrictsFromConfig error:', String(e));
    return jsonError(req.requestId, 'INTERNAL_ERROR', String(e));
  }
}

// ── globalThis exports for test environment ──────────────────
// In GAS all functions are globally scoped. In Node.js/Jest each
// require() runs in its own module scope, so helpers needed by
// other modules must be reachable via globalThis.
(globalThis as any).getSheet                 = getSheet;
(globalThis as any).getConfigMap            = getConfigMap;
(globalThis as any).getConfigValue          = getConfigValue;
(globalThis as any).setConfigValue          = setConfigValue;
(globalThis as any).clearConfigCache        = clearConfigCache;
(globalThis as any).getDistrictsFromConfig  = getDistrictsFromConfig;

// Export config constants so cross-module calls can resolve them in the test environment
(globalThis as any).SHEET_NAMES    = SHEET_NAMES;
(globalThis as any).GMAIL_SHEETS   = GMAIL_SHEETS;
(globalThis as any).MM_COL         = MM_COL;
(globalThis as any).ML_COL         = ML_COL;
(globalThis as any).ML_MM_OFFSET   = ML_MM_OFFSET;
(globalThis as any).WE_COL         = WE_COL;
(globalThis as any).PH_COL         = PH_COL;
(globalThis as any).OTP_COL        = OTP_COL;
(globalThis as any).LOG_COL        = LOG_COL;
(globalThis as any).OE_COL         = OE_COL;
(globalThis as any).FG_COL         = FG_COL;
(globalThis as any).CFG_COL        = CFG_COL;
(globalThis as any).PCE_COL        = PCE_COL;
(globalThis as any).MEMBERSHIP_SPREADSHEET_ID = MEMBERSHIP_SPREADSHEET_ID;
(globalThis as any).GMAIL_SPREADSHEET_ID      = GMAIL_SPREADSHEET_ID;
(globalThis as any).EMAIL_LOG_SHEET_ID        = EMAIL_LOG_SHEET_ID;
(globalThis as any).EMAIL_LOG_SHEET_NAME      = EMAIL_LOG_SHEET_NAME;

// CONFIG object for cross-module access
const CONFIG = {
  EMAIL_LOG_SHEET_ID,
  EMAIL_LOG_SHEET_NAME,
};
(globalThis as any).CONFIG = CONFIG;
