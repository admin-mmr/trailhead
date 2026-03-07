// ============================================================
// renewal.ts — unit tests
// Covers: submitDuesPayment, approveDuesPayment (branches A/B/C),
//         rejectDuesPayment, backward-compat aliases
// ============================================================

require('../src/types');
require('../src/ui');
require('../src/config');
require('../src/sheets');
require('../src/logger');
require('../src/dues');

declare function submitDuesPayment(jsonRequest: string): string;
declare function submitRenewalRequest(jsonRequest: string): string;
declare function approveDuesPayment(jsonRequest: string): string;
declare function approveRenewal(jsonRequest: string): string;
declare function rejectDuesPayment(jsonRequest: string): string;
declare function rejectRenewal(jsonRequest: string): string;
declare function __seedSheet(name: string, rows: any[][]): void;
declare function __getSheet(name: string): any[][];
declare function findMemberByID(id: string): any;
declare function findMembersByFamilyID(id: string): any[];
declare function findWebAppEvent(id: string): any;
declare function logMainTableRow(memberID: string): void;
declare function appendPaymentRecord(record: any): string;
declare function appendWebAppEvent(ev: any): string;
declare function updateWebAppEventRow(idx: number, updates: any): void;
declare function updateMemberRow(idx: number, updates: any): void;
declare function getConfigValue(key: string): string;
declare function generateFamilyID(): string;
declare function auditLog(action: string, data?: any): void;

// ── Shared helpers ──────────────────────────────────────────

const MAIN    = 'Main';
const EVENTS  = 'WebApp-Events';
const LOG_SHEET = 'Membership-Master-Log';
const CONFIG  = 'Config';
const HISTORY = 'Payment-History';

function seedConfig(): void {
  __seedSheet(CONFIG, [
    ['Key', 'Value', 'Description'],
    ['PaymentProofReviewDays', '7',  ''],
    ['MembershipRenewalYears', '1',  ''],
    ['IndividualPrice',        '30', ''],
    ['FamilyPrice',            '50', ''],
  ]);
}

function seedEmptyHistory(): void {
  __seedSheet(HISTORY, [new Array(17).fill('')]);
}

function seedEmptyLog(): void {
  __seedSheet(LOG_SHEET, [new Array(25).fill('')]);
}

/** 23-column Main row. */
function makeMainRow(overrides: Record<number, any> = {}): any[] {
  const future = new Date();
  future.setFullYear(future.getFullYear() + 1);
  const row: any[] = new Array(23).fill('');
  row[0] = 'A0001';
  row[1] = 'active';
  row[3] = future.toISOString();
  row[4] = 'alice@example.com';
  row[5] = 'Alice';
  row[7] = 'Individual';
  Object.entries(overrides).forEach(([k, v]) => { row[Number(k)] = v; });
  return row;
}

/** 24-column WebApp-Events row. */
function makeEventRow(overrides: Record<number, any> = {}): any[] {
  const row: any[] = new Array(24).fill('');
  row[0]  = 'EV001';                        // EVENT_ID
  row[1]  = 'dues_payment';                  // EVENT_TYPE
  row[2]  = new Date().toISOString();        // TIMESTAMP
  row[3]  = new Date(Date.now() + 7 * 86400000).toISOString(); // EXPIRES_AT
  row[4]  = 'A0001';                         // MEMBER_ID
  row[5]  = 'alice@example.com';             // EMAIL
  row[6]  = 'Individual Membership';         // PAYMENT_INTENT
  row[7]  = 30;                              // AMOUNT
  row[13] = 'Matched';                       // STATUS
  Object.entries(overrides).forEach(([k, v]) => { row[Number(k)] = v; });
  return row;
}

/** Minimal ApiRequest JSON. */
function req(payload: object): string {
  return JSON.stringify({ requestId: 'test-req', payload });
}

// ── submitDuesPayment ───────────────────────────────────────

describe('submitDuesPayment', () => {
  beforeEach(() => {
    seedConfig();
    __seedSheet(EVENTS, [new Array(24).fill('')]);
  });

  it('creates a dues_payment event with Pending status', () => {
    const res = JSON.parse(submitDuesPayment(req({
      memberId:      'A0001',
      email:         'alice@example.com',
      sessionID:     's1',
      paymentIntent: 'Individual Membership',
      amount:        30,
      paymentMethod: 'Zelle',
      payerName:     'Alice',
      memoField:     'A0001',
    })));

    expect(res.ok).toBe(true);
    expect(res.payload.eventID).toBeTruthy();

    const evRows = __getSheet(EVENTS);
    expect(evRows.length).toBe(2);
    expect(evRows[1][1]).toBe('dues_payment');          // EVENT_TYPE
    expect(evRows[1][6]).toBe('Individual Membership'); // PAYMENT_INTENT
    expect(evRows[1][13]).toBe('Pending');               // STATUS
  });

  it('stores expiresAt as a future timestamp', () => {
    submitDuesPayment(req({
      memberId: 'A0001', email: 'alice@example.com', sessionID: 's1',
      paymentIntent: 'Individual Membership', amount: 30,
      paymentMethod: 'Venmo', payerName: 'Alice', memoField: '',
    }));
    const evRows = __getSheet(EVENTS);
    const expiresAt = new Date(evRows[1][3]);
    expect(expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it('backward-compat alias submitRenewalRequest delegates to submitDuesPayment', () => {
    const res = JSON.parse(submitRenewalRequest(req({
      memberId: 'A0001', email: 'alice@example.com', sessionID: 's1',
      paymentIntent: 'Individual Membership', amount: 30,
      paymentMethod: 'Zelle', payerName: 'Alice', memoField: '',
    })));
    expect(res.ok).toBe(true);
    const evRows = __getSheet(EVENTS);
    expect(evRows[1][1]).toBe('dues_payment');
  });
});

// ── approveDuesPayment — Branch A: Individual Membership ────

describe('approveDuesPayment — Branch A (Individual Membership)', () => {
  beforeEach(() => {
    seedConfig();
    seedEmptyHistory();
    seedEmptyLog();
  });

  it('extends expiration by 1 year and sets status = active', () => {
    const past = new Date();
    past.setFullYear(past.getFullYear() - 1);
    __seedSheet(MAIN, [new Array(23).fill(''), makeMainRow({ 1: 'inactive', 3: past.toISOString() })]);
    __seedSheet(EVENTS, [new Array(24).fill(''), makeEventRow()]);

    const res = JSON.parse(approveDuesPayment(req({
      eventID: 'EV001', adminEmail: 'admin@mmrunners.org', notes: '',
    })));
    expect(res.ok).toBe(true);
    expect(res.payload.periodEnd).toBeTruthy();

    const mainRows = __getSheet(MAIN);
    expect(mainRows[1][1]).toBe('active');     // STATUS
    expect(mainRows[1][7]).toBe('Individual'); // TYPE unchanged

    // Expiration should be in the future
    const newExp = new Date(mainRows[1][3]);
    expect(newExp.getTime()).toBeGreaterThan(Date.now());
  });

  it('extends from current expiration (not today) when still active', () => {
    const future6mo = new Date();
    future6mo.setMonth(future6mo.getMonth() + 6);
    __seedSheet(MAIN, [new Array(23).fill(''), makeMainRow({ 3: future6mo.toISOString() })]);
    __seedSheet(EVENTS, [new Array(24).fill(''), makeEventRow()]);

    const res = JSON.parse(approveDuesPayment(req({
      eventID: 'EV001', adminEmail: 'admin@mmrunners.org', notes: '',
    })));
    expect(res.ok).toBe(true);

    const mainRows = __getSheet(MAIN);
    const newExp = new Date(mainRows[1][3]);
    // Should be approx 1 year from the existing 6-month expiration (~18 months from now)
    const expected = new Date(future6mo);
    expected.setFullYear(expected.getFullYear() + 1);
    // Allow ±2 days tolerance
    expect(Math.abs(newExp.getTime() - expected.getTime())).toBeLessThan(2 * 86400000);
  });

  it('marks the WebApp-Events row as Approved', () => {
    __seedSheet(MAIN, [new Array(23).fill(''), makeMainRow()]);
    __seedSheet(EVENTS, [new Array(24).fill(''), makeEventRow()]);

    approveDuesPayment(req({ eventID: 'EV001', adminEmail: 'admin@mmrunners.org', notes: 'ok' }));
    const evRows = __getSheet(EVENTS);
    expect(evRows[1][13]).toBe('Approved');            // STATUS
    expect(evRows[1][16]).toBe('admin@mmrunners.org'); // ADMIN_APPROVER
  });

  it('appends a record to Payment-History', () => {
    __seedSheet(MAIN, [new Array(23).fill(''), makeMainRow()]);
    __seedSheet(EVENTS, [new Array(24).fill(''), makeEventRow()]);

    approveDuesPayment(req({ eventID: 'EV001', adminEmail: 'admin@mmrunners.org', notes: '' }));
    const histRows = __getSheet(HISTORY);
    expect(histRows.length).toBe(2); // header + 1 payment record
  });

  it('writes a log row before updating Main', () => {
    __seedSheet(MAIN, [new Array(23).fill(''), makeMainRow()]);
    __seedSheet(EVENTS, [new Array(24).fill(''), makeEventRow()]);

    approveDuesPayment(req({ eventID: 'EV001', adminEmail: 'admin@mmrunners.org', notes: '' }));
    const logRows = __getSheet(LOG_SHEET);
    expect(logRows.length).toBe(2); // header + 1 log row
    expect(logRows[1][0]).toMatch(/^ML-/);
  });

  it('returns NOT_FOUND when event does not exist', () => {
    __seedSheet(MAIN, [new Array(23).fill(''), makeMainRow()]);
    __seedSheet(EVENTS, [new Array(24).fill('')]);
    const res = JSON.parse(approveDuesPayment(req({ eventID: 'NOEVENT', adminEmail: 'admin@mmrunners.org' })));
    expect(res.ok).toBe(false);
    expect(res.errorCode).toBe('NOT_FOUND');
  });

  it('backward-compat alias approveRenewal delegates to approveDuesPayment', () => {
    __seedSheet(MAIN, [new Array(23).fill(''), makeMainRow()]);
    __seedSheet(EVENTS, [new Array(24).fill(''), makeEventRow()]);
    const res = JSON.parse(approveRenewal(req({ eventID: 'EV001', adminEmail: 'admin@mmrunners.org' })));
    expect(res.ok).toBe(true);
  });
});

// ── approveDuesPayment — Branch B: Family Membership ────────

describe('approveDuesPayment — Branch B (Family Membership)', () => {
  beforeEach(() => {
    seedConfig();
    seedEmptyHistory();
    seedEmptyLog();
  });

  it('extends expiration and sets active for all family members', () => {
    const past = new Date();
    past.setFullYear(past.getFullYear() - 1);

    const member1 = makeMainRow({ 0: 'A0001', 1: 'pending_upgrade', 3: past.toISOString(), 7: 'Family', 8: 'B001' });
    const member2 = makeMainRow({ 0: 'A0002', 1: 'inactive',        3: past.toISOString(), 7: 'Family', 8: 'B001', 4: 'bob@example.com' });
    __seedSheet(MAIN, [new Array(23).fill(''), member1, member2]);

    const evRow = makeEventRow({ 4: 'A0001', 6: 'Family Membership', 7: 50 });
    __seedSheet(EVENTS, [new Array(24).fill(''), evRow]);

    const res = JSON.parse(approveDuesPayment(req({ eventID: 'EV001', adminEmail: 'admin@mmrunners.org', notes: '' })));
    expect(res.ok).toBe(true);

    const mainRows = __getSheet(MAIN);
    // Both members updated
    expect(mainRows[1][1]).toBe('active');
    expect(mainRows[2][1]).toBe('active');
    expect(mainRows[1][7]).toBe('Family');
    expect(mainRows[2][7]).toBe('Family');

    // Both expirations are in the future
    expect(new Date(mainRows[1][3]).getTime()).toBeGreaterThan(Date.now());
    expect(new Date(mainRows[2][3]).getTime()).toBeGreaterThan(Date.now());
  });

  it('writes a log row for each family member', () => {
    const member1 = makeMainRow({ 0: 'A0001', 7: 'Family', 8: 'B001' });
    const member2 = makeMainRow({ 0: 'A0002', 7: 'Family', 8: 'B001', 4: 'bob@example.com' });
    __seedSheet(MAIN, [new Array(23).fill(''), member1, member2]);

    const evRow = makeEventRow({ 6: 'Family Membership', 7: 50 });
    __seedSheet(EVENTS, [new Array(24).fill(''), evRow]);

    approveDuesPayment(req({ eventID: 'EV001', adminEmail: 'admin@mmrunners.org', notes: '' }));
    const logRows = __getSheet(LOG_SHEET);
    // One log row per family member
    expect(logRows.length).toBe(3); // header + 2 log rows
  });
});

// ── approveDuesPayment — Branch C: Family Upgrade ───────────

describe('approveDuesPayment — Branch C (Family Upgrade)', () => {
  beforeEach(() => {
    seedConfig();
    seedEmptyHistory();
    seedEmptyLog();
  });

  it('returns INVALID_STATE when member is not in pending_upgrade', () => {
    __seedSheet(MAIN, [new Array(23).fill(''), makeMainRow({ 7: 'Family', 8: 'B001' })]);
    const evRow = makeEventRow({ 6: 'Family Upgrade', 7: 20 });
    __seedSheet(EVENTS, [new Array(24).fill(''), evRow]);

    const res = JSON.parse(approveDuesPayment(req({ eventID: 'EV001', adminEmail: 'admin@mmrunners.org' })));
    expect(res.ok).toBe(false);
    expect(res.errorCode).toBe('INVALID_STATE');
  });

  it('sets active and Family type WITHOUT changing expiration', () => {
    const futureDate = new Date();
    futureDate.setMonth(futureDate.getMonth() + 8); // 8 months out
    const expStr = futureDate.toISOString().split('T')[0];

    __seedSheet(MAIN, [new Array(23).fill(''),
      makeMainRow({ 1: 'pending_upgrade', 3: expStr, 7: 'Family', 8: 'B001' }),
    ]);
    const evRow = makeEventRow({ 6: 'Family Upgrade', 7: 20 });
    __seedSheet(EVENTS, [new Array(24).fill(''), evRow]);

    const res = JSON.parse(approveDuesPayment(req({ eventID: 'EV001', adminEmail: 'admin@mmrunners.org', notes: '' })));
    expect(res.ok).toBe(true);

    const mainRows = __getSheet(MAIN);
    expect(mainRows[1][1]).toBe('active');
    expect(mainRows[1][7]).toBe('Family');
    // Expiration must not have changed — compare date portion only
    expect(mainRows[1][3]).toBe(expStr);
  });

  it('sets all family members to active when upgrading', () => {
    const expStr = new Date(Date.now() + 8 * 30 * 86400000).toISOString().split('T')[0];

    const member1 = makeMainRow({ 0: 'A0001', 1: 'pending_upgrade', 3: expStr, 7: 'Family', 8: 'B001' });
    const member2 = makeMainRow({ 0: 'A0002', 1: 'pending_upgrade', 3: expStr, 7: 'Family', 8: 'B001', 4: 'bob@example.com' });
    __seedSheet(MAIN, [new Array(23).fill(''), member1, member2]);

    const evRow = makeEventRow({ 6: 'Family Upgrade', 7: 20 });
    __seedSheet(EVENTS, [new Array(24).fill(''), evRow]);

    approveDuesPayment(req({ eventID: 'EV001', adminEmail: 'admin@mmrunners.org', notes: '' }));

    const mainRows = __getSheet(MAIN);
    expect(mainRows[1][1]).toBe('active');
    expect(mainRows[2][1]).toBe('active');
    // Expirations unchanged
    expect(mainRows[1][3]).toBe(expStr);
    expect(mainRows[2][3]).toBe(expStr);
  });

  it('writes log rows for each member before updating', () => {
    const expStr = new Date(Date.now() + 8 * 30 * 86400000).toISOString().split('T')[0];
    const member1 = makeMainRow({ 0: 'A0001', 1: 'pending_upgrade', 3: expStr, 7: 'Family', 8: 'B001' });
    const member2 = makeMainRow({ 0: 'A0002', 1: 'pending_upgrade', 3: expStr, 7: 'Family', 8: 'B001', 4: 'bob@example.com' });
    __seedSheet(MAIN, [new Array(23).fill(''), member1, member2]);

    const evRow = makeEventRow({ 6: 'Family Upgrade', 7: 20 });
    __seedSheet(EVENTS, [new Array(24).fill(''), evRow]);

    approveDuesPayment(req({ eventID: 'EV001', adminEmail: 'admin@mmrunners.org', notes: '' }));
    const logRows = __getSheet(LOG_SHEET);
    expect(logRows.length).toBe(3); // header + 2 log rows
  });
});

// ── rejectDuesPayment ───────────────────────────────────────

describe('rejectDuesPayment', () => {
  beforeEach(() => {
    seedConfig();
    seedEmptyLog();
  });

  it('sets WebApp-Events STATUS = Rejected', () => {
    __seedSheet(EVENTS, [new Array(24).fill(''), makeEventRow()]);
    const res = JSON.parse(rejectDuesPayment(req({
      eventID: 'EV001', adminEmail: 'admin@mmrunners.org', notes: 'Amount mismatch',
    })));
    expect(res.ok).toBe(true);

    const evRows = __getSheet(EVENTS);
    expect(evRows[1][13]).toBe('Rejected');
    expect(evRows[1][16]).toBe('admin@mmrunners.org');
    expect(evRows[1][18]).toBe('Amount mismatch');
  });

  it('returns NOT_FOUND when event does not exist', () => {
    __seedSheet(EVENTS, [new Array(24).fill('')]);
    const res = JSON.parse(rejectDuesPayment(req({ eventID: 'NOSUCH', adminEmail: 'admin@mmrunners.org', notes: '' })));
    expect(res.ok).toBe(false);
    expect(res.errorCode).toBe('NOT_FOUND');
  });

  it('backward-compat alias rejectRenewal delegates to rejectDuesPayment', () => {
    __seedSheet(EVENTS, [new Array(24).fill(''), makeEventRow()]);
    const res = JSON.parse(rejectRenewal(req({ eventID: 'EV001', adminEmail: 'admin@mmrunners.org', notes: '' })));
    expect(res.ok).toBe(true);
    const evRows = __getSheet(EVENTS);
    expect(evRows[1][13]).toBe('Rejected');
  });

  it('does not modify the Main table on rejection', () => {
    __seedSheet(MAIN, [new Array(23).fill(''), makeMainRow()]);
    __seedSheet(EVENTS, [new Array(24).fill(''), makeEventRow()]);

    rejectDuesPayment(req({ eventID: 'EV001', adminEmail: 'admin@mmrunners.org', notes: '' }));

    const mainRows = __getSheet(MAIN);
    // Member unchanged: still active, expiration intact
    expect(mainRows[1][1]).toBe('active');
    expect(mainRows[1][7]).toBe('Individual');
  });
});

export {};
