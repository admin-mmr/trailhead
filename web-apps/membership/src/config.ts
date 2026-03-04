// ============================================================
// Spreadsheet configuration
// MEMBERSHIP_SPREADSHEET_ID: the workbook containing Membership-Master-Main-3
//   and all new sheets (WebApp-Events, Payment-History, Auth-OTP, Config, WebApp-ActivityLog).
// GMAIL_SPREADSHEET_ID: the separate workbook containing the Fetch-Gmail sheet.
// Update both IDs before deploying.
// ============================================================

const MEMBERSHIP_SPREADSHEET_ID = '11SFvgApmDtEv4jz5bTYI9_zEhCFMQAXC4b2z_4s3ljk';
const GMAIL_SPREADSHEET_ID = '1rVOvhXzSxCRpWdAw3jYq5tWrYdCYtXmfqblTHP_wPqA';

// Sheet names
const SHEET_NAMES = {
  MEMBERSHIP_MASTER: 'Main',
  WEBAPP_EVENTS: 'WebApp-Events',
  PAYMENT_HISTORY: 'Payment-History',
  AUTH_OTP: 'Auth-OTP',
  CONFIG: 'Config',
  ACTIVITY_LOG: 'WebApp-ActivityLog',
  FETCH_GMAIL: 'Active',
  PAYMENT_EVENTS: 'Payment Confirmation Events',
  PAYMENT_PROOFS: 'Payment-Proofs',
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
  WEBAPP: 12,
  PAYMENT_CHECK: 13,
  INFO: 14,
  LAST_UPDATED: 15,
  MEMBERSHIP_FEE_PAID: 16,
  PAYMENT_DATE: 17,
  PAYMENT_TRANSACTION: 18,
  // New columns appended after existing ones
  JOIN_YEAR: 19,
  PHONE_NUMBER: 20,
  LAST_LOGIN_DATE: 21,
  NOTES: 22,
};

// WebApp-Events column indices (0-based)
const WE_COL = {
  EVENT_ID: 0,
  EVENT_TYPE: 1,
  TIMESTAMP: 2,
  MEMBER_ID: 3,
  EMAIL: 4,
  PAYMENT_INTENT: 5,
  AMOUNT: 6,
  PAYMENT_METHOD: 7,
  PAYER_NAME: 8,
  MEMO_FIELD: 9,
  LAST_4_DIGITS: 10,
  FAMILY_MEMBER_EMAILS: 11,
  STATUS: 12,
  MATCHED_MESSAGE_ID: 13,
  MATCHED_TRANSACTION_NUMBER: 14,
  ADMIN_APPROVER: 15,
  APPROVAL_DATE: 16,
  NOTES: 17,
};

// Payment-History column indices (0-based)
const PH_COL = {
  PAYMENT_ID: 0,
  EVENT_ID: 1,
  MEMBER_ID: 2,
  PAYMENT_DATE: 3,
  AMOUNT: 4,
  MEMBERSHIP_TYPE: 5,
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
  WEBAPP_EVENT_ID: 12,
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

// Payment-Proofs column indices (0-based)
const PP_COL = {
  EVENT_ID: 0,
  TIMESTAMP: 1,
  MEMBER_ID: 2,
  EMAIL: 3,
  EVENT_NAME: 4,
  AMOUNT: 5,
  PAYMENT_DATE: 6,
  PAYER_NAME: 7,
  LAST_4_DIGITS: 8,
  NOTES: 9,
  SCREENSHOT_FILE_ID: 10,
  STATUS: 11,
  GDRIVE_FILE_PATH: 12,
  OCR_TEXT: 13,
  OCR_TIMESTAMP: 14,
};


// ============================================================
// Sheet headers for auto-creation (new sheets only)
// Existing sheets (Membership Master, Fetch-Gmail) must already exist.
// ============================================================

const SHEET_HEADERS: Record<string, string[]> = {
  [SHEET_NAMES.WEBAPP_EVENTS]: [
    'EventID', 'EventType', 'Timestamp', 'MemberID', 'Email',
    'PaymentIntent', 'Amount', 'PaymentMethod', 'PayerName', 'MemoField',
    'Last4Digits', 'FamilyMemberEmails', 'Status',
    'MatchedMessageId', 'MatchedTransactionNumber',
    'AdminApprover', 'ApprovalDate', 'Notes',
  ],
  [SHEET_NAMES.PAYMENT_HISTORY]: [
    'PaymentID', 'EventID', 'MemberID', 'PaymentDate', 'Amount',
    'PaymentIntent', 'PaymentMethod', 'PayerName', 'MemoField',
    'Last4Digits', 'TransactionReference', 'PeriodStart', 'PeriodEnd',
    'ProcessedBy', 'ProcessedDate', 'Source', 'Notes',
  ],
  [SHEET_NAMES.AUTH_OTP]: [
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
  [SHEET_NAMES.PAYMENT_PROOFS]: [
    'EventID', 'Timestamp', 'MemberID', 'Email', 'EventName', 'Amount',
    'PaymentDate', 'PayerName', 'Last4Digits', 'Notes', 'ScreenshotFileID', 'Status',
    'GDrive File Path', 'OCR Text', 'OCR Timestamp',
  ],
};

// Default Config values seeded on first creation
const DEFAULT_CONFIG_ROWS: string[][] = [
  ['IndividualPrice',        '30',                      'Price for individual membership'],
  ['FamilyPrice',            '50',                      'Price for family membership'],
  ['FamilyUpgradePrice',     '20',                      'Price for family membership'],
  ['PaymentMethods',         'Zelle,Venmo,PayPal',      'Comma-separated accepted payment methods'],
  ['ZelleHandle',            'zelle@example.com',       'Zelle payment handle'],
  ['VenmoHandle',            '@venmo-user',             'Venmo payment handle'],
  ['PayPalHandle',           'paypal@example.com',      'PayPal payment handle'],
  ['ReminderDaysBefore',     '30',                      'Days before expiry to send reminder'],
  ['MembershipRenewalYears', '1',                       'Years added per renewal'],
  ['OTPValidHours',          '24',                      'Hours before OTP expires'],
  ['OTPCleanupDays',         '7',                       'Days before used/expired OTPs are deleted'],
  ['AdminEmails',            'admin@mmrunners.org',     'Comma-separated admin email addresses'],
  ['AppBaseUrl',             '',                        'Deployed web app URL (set after first deploy)'],
  // src/config.ts — in DEFAULT_CONFIG_ROWS
  ['PaymentProofFolderId', '1I-FR4iTC8649XBzFSplyG2XARNBHwflz', 'Google Drive folder ID for payment proofs'],
  ['ZelleQRCodeFileId',      '',                        'Google Drive file ID for Zelle QR code image'],
  ['VenmoQRCodeFileId',      '',                        'Google Drive file ID for Venmo QR code image'],
];

// Default Payment Events values seeded on first creation
const DEFAULT_PAYMENT_EVENTS_ROWS: string[][] = [
  ['Individual Membership', 'Confirm your payment for individual membership renewal', 'Match with payment history'],
  ['Family Membership', 'Confirm your payment for family membership renewal', 'Match with payment history'],
  ['Upgrade to Family Membership', 'Confirm your payment for upgrading to family membership', 'Match with payment history'],
  ['Other Payment', 'Confirm your other payments related to membership', 'Manual review'],
];


// ============================================================
// Spreadsheet + Config helpers
// ============================================================

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

function getConfigMap(): ConfigMap {
  const sheet = getSheet(SHEET_NAMES.CONFIG);
  const rows = sheet.getDataRange().getValues();
  const map: ConfigMap = {};
  for (let i = 1; i < rows.length; i++) {
    const key = String(rows[i][CFG_COL.KEY]).trim();
    const value = String(rows[i][CFG_COL.VALUE]).trim();
    if (key) map[key] = value;
  }
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
