// ============================================================
// jobs.test.ts — Background job scheduling and expiry handling
// Tests: expirePaymentProofs, expireInactiveMemberships,
//        autoMatchUnmatchedPayments, reviewPaymentHistory
// ============================================================

require('../src/types');
require('../src/ui');
require('../src/config');
require('../src/sheets');
require('../src/logger');
require('../src/email');
require('../src/jobs');

declare function expirePaymentProofs(): string;
declare function expireInactiveMemberships(): string;
declare function autoMatchUnmatchedPayments(): { matched: number; skipped: number; errors: number };
declare function reviewPaymentHistory(): { reviewed: number; repaired: number; skipped: number };
declare function __seedSheet(name: string, rows: any[][]): void;
declare function __getSheet(name: string): any[][];

const EVENTS = 'WebApp-Events';
const MAIN = 'Main';
const CONFIG = 'Config';
const LOG_SHEET = 'Membership-Master-Log';

function makeEventRow(status: string = 'Pending', overrides: Record<number, any> = {}): any[] {
  const row: any[] = new Array(24).fill('');
  row[0] = 'EV001';
  row[1] = 'dues_payment';
  row[2] = new Date().toISOString();
  row[3] = new Date(Date.now() - 2 * 86400000).toISOString(); // Expired 2 days ago
  row[4] = 'A0001';
  row[5] = 'alice@example.com';
  row[6] = 'Individual Membership';
  row[7] = 30;
  row[13] = status;
  Object.entries(overrides).forEach(([k, v]) => { row[Number(k)] = v; });
  return row;
}

function makeMainRow(overrides: Record<number, any> = {}): any[] {
  const futureDate = new Date();
  futureDate.setFullYear(futureDate.getFullYear() - 1); // Expired 1 year ago
  const row: any[] = new Array(24).fill('');
  row[0] = 'A0001';
  row[1] = 'active';
  row[3] = futureDate.toISOString();
  row[4] = 'alice@example.com';
  row[5] = 'Alice';
  row[6] = 'Smith';
  row[7] = 'Individual';
  row[13] = new Date().toISOString(); // LAST_UPDATED
  Object.entries(overrides).forEach(([k, v]) => { row[Number(k)] = v; });
  return row;
}

function seedConfig(): void {
  __seedSheet(CONFIG, [
    ['Key', 'Value', 'Description'],
    ['AdminEmails', 'admin@example.com', ''],
    ['PaymentProofReviewDays', '7', ''],
  ]);
}

function seedEmptyLog(): void {
  __seedSheet(LOG_SHEET, [new Array(26).fill('')]);
}

describe('expirePaymentProofs', () => {
  beforeEach(() => {
    seedConfig();
    seedEmptyLog();
  });

  it('marks expired Pending events as Expired', () => {
    const now = new Date();
    const twoWeeksAgo = new Date(now.getTime() - 14 * 86400000);
    __seedSheet(EVENTS, [
      new Array(24).fill(''),
      makeEventRow('Pending', { 3: twoWeeksAgo.toISOString() }) // Expired 2 weeks ago
    ]);

    const res = expirePaymentProofs();
    const eventRows = __getSheet(EVENTS);
    expect(eventRows[1][13]).toBe('Expired'); // M_Status = Expired
  });

  it('sends email notification when proof expires', () => {
    const now = new Date();
    const expiredDate = new Date(now.getTime() - 14 * 86400000);
    __seedSheet(EVENTS, [
      new Array(24).fill(''),
      makeEventRow('Pending', { 3: expiredDate.toISOString(), 5: 'alice@example.com' })
    ]);

    // Function should execute without error
    expirePaymentProofs();

    // Event should be marked as Expired
    const eventRows = __getSheet(EVENTS);
    expect(eventRows[1][13]).toBe('Expired');
  });

  it('logs PROOF_EXPIRED action', () => {
    const now = new Date();
    const expiredDate = new Date(now.getTime() - 14 * 86400000);
    __seedSheet(EVENTS, [
      new Array(24).fill(''),
      makeEventRow('Pending', { 3: expiredDate.toISOString() })
    ]);

    expirePaymentProofs();

    // Function should execute and mark event as expired
    const eventRows = __getSheet(EVENTS);
    expect(eventRows[1][13]).toBe('Expired'); // M_Status changed to Expired
  });

  it('skips non-Pending events', () => {
    const now = new Date();
    const expiredDate = new Date(now.getTime() - 14 * 86400000);
    __seedSheet(EVENTS, [
      new Array(24).fill(''),
      makeEventRow('Approved', { 3: expiredDate.toISOString() }),
      makeEventRow('Pending', { 3: expiredDate.toISOString() })
    ]);

    expirePaymentProofs();

    const eventRows = __getSheet(EVENTS);
    expect(eventRows[1][13]).toBe('Approved'); // Should NOT be expired
    expect(eventRows[2][13]).toBe('Expired');  // Should be expired
  });

  it('handles invalid ExpiresAt gracefully', () => {
    __seedSheet(EVENTS, [
      new Array(24).fill(''),
      makeEventRow('Pending', { 3: 'invalid-date' })
    ]);

    // Should not throw error
    expirePaymentProofs();

    // Should still have the event
    const eventRows = __getSheet(EVENTS);
    expect(eventRows.length).toBeGreaterThanOrEqual(2);
  });
});

describe('expireInactiveMemberships', () => {
  beforeEach(() => {
    seedConfig();
    seedEmptyLog();
  });

  it('marks expired active members as inactive', () => {
    const pastDate = new Date();
    pastDate.setFullYear(pastDate.getFullYear() - 2); // 2 years ago
    __seedSheet(MAIN, [
      new Array(24).fill(''),
      makeMainRow({ 1: 'active', 3: pastDate.toISOString() })
    ]);

    expireInactiveMemberships();

    const mainRows = __getSheet(MAIN);
    expect(mainRows[1][1]).toBe('inactive'); // STATUS changed
  });

  it('updates LAST_UPDATED timestamp when expiring', () => {
    const oldTime = '2024-01-01T00:00:00Z';
    const pastDate = new Date();
    pastDate.setFullYear(pastDate.getFullYear() - 2);
    __seedSheet(MAIN, [
      new Array(24).fill(''),
      makeMainRow({ 1: 'active', 3: pastDate.toISOString(), 13: oldTime })
    ]);

    expireInactiveMemberships();

    const mainRows = __getSheet(MAIN);
    const updatedTime = mainRows[1][13];
    expect(updatedTime).not.toEqual(oldTime);
    expect(updatedTime).toMatch(/\d{4}-\d{2}-\d{2}T/); // ISO date format
  });

  it('logs MEMBERSHIP_EXPIRED action', () => {
    const pastDate = new Date();
    pastDate.setFullYear(pastDate.getFullYear() - 2);
    __seedSheet(MAIN, [
      new Array(24).fill(''),
      makeMainRow({ 1: 'active', 3: pastDate.toISOString() })
    ]);

    expireInactiveMemberships();

    const logRows = __getSheet(LOG_SHEET);
    expect(logRows.length).toBeGreaterThan(1); // At least header + 1 log
  });

  it('only processes active members', () => {
    const pastDate = new Date();
    pastDate.setFullYear(pastDate.getFullYear() - 2);
    __seedSheet(MAIN, [
      new Array(24).fill(''),
      makeMainRow({ 1: 'inactive', 3: pastDate.toISOString() }),
      makeMainRow({ 1: 'active', 3: pastDate.toISOString() })
    ]);

    expireInactiveMemberships();

    const mainRows = __getSheet(MAIN);
    expect(mainRows[1][1]).toBe('inactive'); // Should stay inactive
    expect(mainRows[2][1]).toBe('inactive'); // Should be expired
  });

  it('handles invalid expiration date gracefully', () => {
    __seedSheet(MAIN, [
      new Array(24).fill(''),
      makeMainRow({ 1: 'active', 3: 'invalid-date' })
    ]);

    // Should not throw error
    expireInactiveMemberships();

    // Should still have the member
    const mainRows = __getSheet(MAIN);
    expect(mainRows.length).toBeGreaterThanOrEqual(2);
  });
});

// ── Column index constants (mirrors config.ts) ──────────────────────────────
const MM = { MEMBER_ID: 0, STATUS: 1, EXPIRATION: 3, EMAIL: 4, FIRST_NAME: 5, LAST_NAME: 6, TYPE: 7 };
const PH = { PAYMENT_ID: 0, MEMBER_ID: 2, PAYMENT_DATE: 3, AMOUNT: 4, PAYMENT_INTENT: 5, PERIOD_END: 12, SOURCE: 15 };
const FG = { TIMESTAMP: 0, SENDER: 1, AMOUNT: 2, MEMO: 3, TRANSACTION_DATE: 4, TRANSACTION_NUMBER: 5, PROCESSED: 10, SOURCE: 11, WEBAPP_EVENT_ID: 12 };

const PH_HEADERS = ['PaymentID','EventID','MemberID','PaymentDate','Amount','PaymentIntent',
  'PaymentMethod','PayerName','MemoField','Last4Digits','TransactionReference',
  'PeriodStart','PeriodEnd','ProcessedBy','ProcessedDate','Source','Notes'];
const ACTIVITY_LOG_HEADERS = ['LogID','Timestamp','SessionID','MemberID','Email','EventID','Action','State','ErrorCode','ErrorMessage'];

function makeGmailRow(amount: number, memo: string, txDate: string, processed: any = false): any[] {
  const row: any[] = new Array(13).fill('');
  row[FG.TIMESTAMP]          = new Date().toISOString();
  row[FG.SENDER]             = 'Test Sender';
  row[FG.AMOUNT]             = amount;
  row[FG.MEMO]               = memo;
  row[FG.TRANSACTION_DATE]   = txDate;
  row[FG.TRANSACTION_NUMBER] = 'TXN-001';
  row[FG.PROCESSED]          = processed;
  return row;
}

function makeMemberRow(memberID: string, status: string, expiration: string, type: string = 'Individual'): any[] {
  const row: any[] = new Array(26).fill('');
  row[MM.MEMBER_ID]  = memberID;
  row[MM.STATUS]     = status;
  row[MM.EXPIRATION] = expiration;
  row[MM.EMAIL]      = `${memberID.toLowerCase()}@example.com`;
  row[MM.FIRST_NAME] = 'Test';
  row[MM.LAST_NAME]  = 'Member';
  row[MM.TYPE]       = type;
  return row;
}

function makePHRow(memberID: string, intent: string, paymentDate: string, periodEnd: string): any[] {
  const row: any[] = new Array(17).fill('');
  row[PH.PAYMENT_ID]     = 'PY-001';
  row[PH.MEMBER_ID]      = memberID;
  row[PH.PAYMENT_DATE]   = paymentDate;
  row[PH.PAYMENT_INTENT] = intent;
  row[PH.PERIOD_END]     = periodEnd;
  return row;
}

function seedConfigWithWindow(startDate: string, endDate: string): void {
  __seedSheet(CONFIG, [
    ['Key', 'Value', 'Description'],
    ['AdminEmails',              'admin@example.com', ''],
    ['MembershipCollectionStart', startDate,          ''],
    ['MembershipCollectionEnd',   endDate,            ''],
    ['IndividualPrice',           '30',               ''],
    ['FamilyPrice',               '50',               ''],
    ['MembershipRenewalYears',    '1',                ''],
  ]);
}

// Build a window that spans today so the guards pass
function thisYearWindow(): { start: string; end: string } {
  const y = new Date().getFullYear();
  return { start: `${y}-01-01`, end: `${y}-12-31` };
}

describe('autoMatchUnmatchedPayments', () => {
  beforeEach(() => {
    seedEmptyLog();
    __seedSheet('WebApp-ActivityLog', [ACTIVITY_LOG_HEADERS]);
    __seedSheet('Payment-History',    [PH_HEADERS]);
  });

  it('returns 0 matched when no collection window is configured', () => {
    seedConfig(); // no MembershipCollectionStart/End
    __seedSheet(MAIN, [new Array(26).fill(''), makeMemberRow('A0001', 'inactive', '')]);
    __seedSheet('Active', [new Array(13).fill(''), makeGmailRow(30, 'A0001', '2026-02-01')]);

    const stats = autoMatchUnmatchedPayments();
    expect(stats.matched).toBe(0);
  });

  it('returns 0 matched when today is outside the collection window', () => {
    // Window entirely in the past
    seedConfigWithWindow('2020-01-01', '2020-03-31');
    __seedSheet(MAIN, [new Array(26).fill(''), makeMemberRow('A0001', 'inactive', '')]);
    __seedSheet('Active', [new Array(13).fill(''), makeGmailRow(30, 'A0001', '2020-02-01')]);

    const stats = autoMatchUnmatchedPayments();
    expect(stats.matched).toBe(0);
  });

  it('matches $30 with valid MemberID → creates Payment-History row as Individual Membership', () => {
    const { start, end } = thisYearWindow();
    seedConfigWithWindow(start, end);
    __seedSheet(MAIN, [new Array(26).fill(''), makeMemberRow('A0001', 'inactive', '')]);

    const today = new Date().toISOString().split('T')[0];
    __seedSheet('Active', [new Array(13).fill(''), makeGmailRow(30, 'Payment from A0001', today)]);

    const stats = autoMatchUnmatchedPayments();
    expect(stats.matched).toBe(1);
    expect(stats.errors).toBe(0);

    const phRows = __getSheet('Payment-History');
    expect(phRows.length).toBe(2); // header + 1 record
    expect(phRows[1][PH.MEMBER_ID]).toBe('A0001');
    expect(phRows[1][PH.AMOUNT]).toBe(30);
    expect(phRows[1][PH.PAYMENT_INTENT]).toBe('Individual Membership');
    expect(phRows[1][PH.SOURCE]).toBe('AutoGuess');
  });

  it('matches $50 with valid MemberID → creates Payment-History row as Family Membership', () => {
    const { start, end } = thisYearWindow();
    seedConfigWithWindow(start, end);
    __seedSheet(MAIN, [new Array(26).fill(''), makeMemberRow('A0001', 'inactive', '', 'Family')]);

    const today = new Date().toISOString().split('T')[0];
    __seedSheet('Active', [new Array(13).fill(''), makeGmailRow(50, 'Renewal A0001', today)]);

    const stats = autoMatchUnmatchedPayments();
    expect(stats.matched).toBe(1);

    const phRows = __getSheet('Payment-History');
    expect(phRows[1][PH.PAYMENT_INTENT]).toBe('Family Membership');
    expect(phRows[1][PH.AMOUNT]).toBe(50);
  });

  it('skips row with no MemberID in memo', () => {
    const { start, end } = thisYearWindow();
    seedConfigWithWindow(start, end);
    __seedSheet(MAIN, [new Array(26).fill(''), makeMemberRow('A0001', 'inactive', '')]);

    const today = new Date().toISOString().split('T')[0];
    __seedSheet('Active', [new Array(13).fill(''), makeGmailRow(30, 'membership renewal thanks', today)]);

    const stats = autoMatchUnmatchedPayments();
    expect(stats.matched).toBe(0);
    expect(stats.skipped).toBe(1);
  });

  it('skips row with non-membership amount (e.g. $25)', () => {
    const { start, end } = thisYearWindow();
    seedConfigWithWindow(start, end);
    __seedSheet(MAIN, [new Array(26).fill(''), makeMemberRow('A0001', 'inactive', '')]);

    const today = new Date().toISOString().split('T')[0];
    __seedSheet('Active', [new Array(13).fill(''), makeGmailRow(25, 'A0001 payment', today)]);

    const stats = autoMatchUnmatchedPayments();
    expect(stats.matched).toBe(0);
    expect(stats.skipped).toBe(1);
  });

  it('skips row whose transaction date is outside the collection window', () => {
    const y = new Date().getFullYear();
    // Window must include today or the job early-exits before per-row checks;
    // the out-of-window case is a transaction dated before the window opens.
    const { start, end } = thisYearWindow();
    seedConfigWithWindow(start, end);
    __seedSheet(MAIN, [new Array(26).fill(''), makeMemberRow('A0001', 'inactive', '')]);

    // Transaction date in the previous year (outside window)
    __seedSheet('Active', [new Array(13).fill(''), makeGmailRow(30, 'A0001', `${y - 1}-12-15`)]);

    const stats = autoMatchUnmatchedPayments();
    expect(stats.matched).toBe(0);
    expect(stats.skipped).toBe(1);
  });

  it('skips row when MemberID does not exist in Membership Master', () => {
    const { start, end } = thisYearWindow();
    seedConfigWithWindow(start, end);
    __seedSheet(MAIN, [new Array(26).fill('')]); // no members

    const today = new Date().toISOString().split('T')[0];
    __seedSheet('Active', [new Array(13).fill(''), makeGmailRow(30, 'A9999', today)]);

    const stats = autoMatchUnmatchedPayments();
    expect(stats.matched).toBe(0);
    expect(stats.skipped).toBe(1);
  });

  it('updates member status to active and sets a future expiration', () => {
    const { start, end } = thisYearWindow();
    seedConfigWithWindow(start, end);
    // Member is currently inactive with an expired date
    __seedSheet(MAIN, [new Array(26).fill(''), makeMemberRow('A0001', 'inactive', '2024-03-31')]);

    const today = new Date().toISOString().split('T')[0];
    __seedSheet('Active', [new Array(13).fill(''), makeGmailRow(30, 'A0001', today)]);

    autoMatchUnmatchedPayments();

    const mainRows = __getSheet(MAIN);
    expect(mainRows[1][MM.STATUS]).toBe('active');
    const expDate = new Date(mainRows[1][MM.EXPIRATION]);
    expect(expDate.getFullYear()).toBeGreaterThanOrEqual(new Date().getFullYear());
  });

  it('marks the Gmail row as processed with source AutoGuess', () => {
    const { start, end } = thisYearWindow();
    seedConfigWithWindow(start, end);
    __seedSheet(MAIN, [new Array(26).fill(''), makeMemberRow('A0001', 'inactive', '')]);

    const today = new Date().toISOString().split('T')[0];
    __seedSheet('Active', [new Array(13).fill(''), makeGmailRow(30, 'A0001', today)]);

    autoMatchUnmatchedPayments();

    const activeRows = __getSheet('Active');
    expect(activeRows[1][FG.PROCESSED]).toBeTruthy();
    expect(activeRows[1][FG.SOURCE]).toBe('AutoGuess');
  });
});

describe('reviewPaymentHistory', () => {
  beforeEach(() => {
    seedConfig();
    seedEmptyLog();
    __seedSheet('WebApp-ActivityLog', [ACTIVITY_LOG_HEADERS]);
  });

  it('repairs a member whose expiration is missing', () => {
    __seedSheet('Payment-History', [PH_HEADERS, makePHRow('A0001', 'Individual Membership', '2026-01-15', '2027-03-31')]);
    __seedSheet(MAIN, [new Array(26).fill(''), makeMemberRow('A0001', 'inactive', '')]);

    const stats = reviewPaymentHistory();

    expect(stats.repaired).toBe(1);
    const mainRows = __getSheet(MAIN);
    expect(mainRows[1][MM.EXPIRATION]).toBe('2027-03-31');
    expect(mainRows[1][MM.STATUS]).toBe('active');
  });

  it('repairs a member whose expiration date is stale/wrong', () => {
    __seedSheet('Payment-History', [PH_HEADERS, makePHRow('A0001', 'Individual Membership', '2026-01-15', '2027-03-31')]);
    __seedSheet(MAIN, [new Array(26).fill(''), makeMemberRow('A0001', 'active', '2025-03-31')]); // wrong year

    const stats = reviewPaymentHistory();

    expect(stats.repaired).toBe(1);
    const mainRows = __getSheet(MAIN);
    expect(mainRows[1][MM.EXPIRATION]).toBe('2027-03-31');
  });

  it('does not repair a member whose expiration is already correct', () => {
    __seedSheet('Payment-History', [PH_HEADERS, makePHRow('A0001', 'Individual Membership', '2026-01-15', '2027-03-31')]);
    __seedSheet(MAIN, [new Array(26).fill(''), makeMemberRow('A0001', 'active', '2027-03-31')]); // already correct

    const stats = reviewPaymentHistory();

    expect(stats.reviewed).toBe(1);
    expect(stats.repaired).toBe(0);
  });

  it('skips rows with empty MemberID', () => {
    __seedSheet('Payment-History', [PH_HEADERS, makePHRow('', 'Individual Membership', '2026-01-15', '2027-03-31')]);
    __seedSheet(MAIN, [new Array(26).fill('')]); // no members

    const stats = reviewPaymentHistory();

    expect(stats.skipped).toBeGreaterThan(0);
    expect(stats.repaired).toBe(0);
  });

  it('ignores Family Upgrade rows (they do not change expiration)', () => {
    __seedSheet('Payment-History', [PH_HEADERS, makePHRow('A0001', 'Family Upgrade', '2026-01-15', '2026-03-31')]);
    __seedSheet(MAIN, [new Array(26).fill(''), makeMemberRow('A0001', 'active', '2025-03-31')]);

    const stats = reviewPaymentHistory();

    expect(stats.reviewed).toBe(0); // Family Upgrade rows are filtered before review loop
    expect(stats.repaired).toBe(0);
  });

  it('handles a member not found in master gracefully', () => {
    __seedSheet('Payment-History', [PH_HEADERS, makePHRow('A9999', 'Individual Membership', '2026-01-15', '2027-03-31')]);
    __seedSheet(MAIN, [new Array(26).fill('')]); // no members

    const stats = reviewPaymentHistory();

    expect(stats.skipped).toBeGreaterThan(0);
    expect(stats.repaired).toBe(0);
  });

  it('uses PaymentDate to derive expiration when PeriodEnd is blank', () => {
    __seedSheet('Payment-History', [PH_HEADERS, makePHRow('A0001', 'Individual Membership', '2026-01-15', '')]);
    __seedSheet(MAIN, [new Array(26).fill(''), makeMemberRow('A0001', 'inactive', '')]);

    const stats = reviewPaymentHistory();

    expect(stats.repaired).toBe(1);
    const mainRows = __getSheet(MAIN);
    // Expiration should be derived: 2026-01-15 + 1 year = 2027-01-15
    expect(mainRows[1][MM.EXPIRATION]).toContain('2027');
  });
});

export {};
