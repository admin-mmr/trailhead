// ============================================================
// upgrade.ts — unit tests
// Covers: initiateSwitch, initiateUpgrade, cancelUpgrade
// ============================================================

require('../src/types');
require('../src/ui');
require('../src/config');
require('../src/sheets');
require('../src/logger');
require('../src/upgrade');

declare function initiateSwitch(jsonRequest: string): string;
declare function initiateUpgrade(jsonRequest: string): string;
declare function cancelUpgrade(jsonRequest: string): string;
declare function __seedSheet(name: string, rows: any[][]): void;
declare function __getSheet(name: string): any[][];
declare function findMemberByID(id: string): any;
declare function findMembersByFamilyID(id: string): any[];
declare function logMainTableRow(memberID: string): void;
declare function generateFamilyID(): string;
declare function appendWebAppEvent(ev: any): string;
declare function getPendingWebAppEvents(): any[];
declare function findWebAppEvent(id: string): any;
declare function updateWebAppEventRow(idx: number, updates: any): void;
declare function updateMemberRow(idx: number, updates: any): void;
declare function getConfigMap(): any;
declare function auditLog(action: string, data?: any): void;

// ── Shared helpers ──────────────────────────────────────────

const MAIN    = 'Main';
const EVENTS  = 'WebApp-Events';
const LOG_SHEET = 'Membership-Master-Log';
const CONFIG  = 'Config';

/** Build a 23-column Main row with sensible defaults. */
function makeMainRow(overrides: Record<number, any> = {}): any[] {
  const future = new Date();
  future.setFullYear(future.getFullYear() + 1);
  const row: any[] = new Array(23).fill('');
  row[0] = 'A0001';            // MM_COL.MEMBER_ID
  row[1] = 'active';           // MM_COL.STATUS
  row[3] = future.toISOString(); // MM_COL.EXPIRATION
  row[4] = 'alice@example.com'; // MM_COL.EMAIL
  row[5] = 'Alice';            // MM_COL.FIRST_NAME
  row[7] = 'Individual';       // MM_COL.TYPE
  Object.entries(overrides).forEach(([k, v]) => { row[Number(k)] = v; });
  return row;
}

/** Seed a minimal Config sheet with required keys. */
function seedConfig(extra: string[][] = []): void {
  __seedSheet(CONFIG, [
    ['Key', 'Value', 'Description'],
    ['FamilyPrice',          '50', ''],
    ['FamilyUpgradePrice',   '20', ''],
    ['PaymentProofReviewDays', '7', ''],
    ['UpgradeMinMonths',     '3',  ''],
    ['MembershipRenewalYears', '1', ''],
    ...extra,
  ]);
}

/** Seed header + one member row in Main. */
function seedMain(memberRow: any[]): void {
  __seedSheet(MAIN, [new Array(23).fill(''), memberRow]);
}

/** Seed empty Events sheet (header only). */
function seedEmptyEvents(): void {
  __seedSheet(EVENTS, [new Array(24).fill('')]);
}

/** Seed empty Log sheet (header only). */
function seedEmptyLog(): void {
  __seedSheet(LOG_SHEET, [new Array(25).fill('')]);
}

/** Build a minimal ApiRequest JSON string. */
function req(payload: object): string {
  return JSON.stringify({ requestId: 'test-req', payload });
}

// ── initiateSwitch ──────────────────────────────────────────

describe('initiateSwitch', () => {
  beforeEach(() => {
    seedConfig();
    seedEmptyEvents();
    seedEmptyLog();
  });

  it('returns error when member not found', () => {
    seedMain(makeMainRow({ 0: 'A0002' }));
    const res = JSON.parse(initiateSwitch(req({ memberID: 'A9999', email: 'x@x.com', sessionID: 's1' })));
    expect(res.ok).toBe(false);
    expect(res.errorCode).toBe('NOT_FOUND');
  });

  it('returns error when status is already pending_upgrade', () => {
    seedMain(makeMainRow({ 1: 'pending_upgrade' }));
    const res = JSON.parse(initiateSwitch(req({ memberID: 'A0001', email: 'alice@example.com', sessionID: 's1' })));
    expect(res.ok).toBe(false);
    expect(res.errorCode).toBe('INVALID_STATE');
  });

  it('returns error when member is already active Family', () => {
    seedMain(makeMainRow({ 1: 'active', 7: 'Family', 8: 'B001' }));
    const res = JSON.parse(initiateSwitch(req({ memberID: 'A0001', email: 'alice@example.com', sessionID: 's1' })));
    expect(res.ok).toBe(false);
    expect(res.errorCode).toBe('INVALID_STATE');
  });

  it('succeeds for inactive Individual member — sets pending_upgrade and creates event', () => {
    const past = new Date();
    past.setFullYear(past.getFullYear() - 1);
    seedMain(makeMainRow({ 1: 'inactive', 3: past.toISOString() }));

    const res = JSON.parse(initiateSwitch(req({ memberID: 'A0001', email: 'alice@example.com', sessionID: 's1' })));
    expect(res.ok).toBe(true);
    expect(res.payload.paymentIntent).toBe('Family Membership');
    expect(res.payload.amount).toBe(50);
    expect(res.payload.familyID).toMatch(/^B\d{3}/);
    expect(res.payload.eventID).toBeTruthy();
  });

  it('succeeds for active Individual member (expiring soon)', () => {
    seedMain(makeMainRow({ 1: 'active', 7: 'Individual' }));
    const res = JSON.parse(initiateSwitch(req({ memberID: 'A0001', email: 'alice@example.com', sessionID: 's1' })));
    expect(res.ok).toBe(true);
    expect(res.payload.paymentIntent).toBe('Family Membership');
  });

  it('sets STATUS = pending_upgrade and TYPE = Family in Main sheet', () => {
    seedMain(makeMainRow());
    initiateSwitch(req({ memberID: 'A0001', email: 'alice@example.com', sessionID: 's1' }));
    const mainRows = __getSheet(MAIN);
    const memberRow = mainRows[1];
    expect(memberRow[1]).toBe('pending_upgrade'); // STATUS
    expect(memberRow[7]).toBe('Family');          // TYPE
    expect(memberRow[8]).toMatch(/^B\d{3}/);      // FAMILY_ID assigned
  });

  it('appends a family_switch event to WebApp-Events with Pending status', () => {
    seedMain(makeMainRow());
    initiateSwitch(req({ memberID: 'A0001', email: 'alice@example.com', sessionID: 's1' }));
    const evRows = __getSheet(EVENTS);
    expect(evRows.length).toBe(2); // header + 1 event
    const evRow = evRows[1];
    expect(evRow[1]).toBe('family_switch');       // WE_COL.EVENT_TYPE
    expect(evRow[6]).toBe('Family Membership');   // WE_COL.PAYMENT_INTENT
    expect(evRow[13]).toBe('Pending');            // WE_COL.STATUS
  });

  it('writes a log row to Membership-Master-Log before the main table update', () => {
    seedMain(makeMainRow());
    initiateSwitch(req({ memberID: 'A0001', email: 'alice@example.com', sessionID: 's1' }));
    const logRows = __getSheet(LOG_SHEET);
    expect(logRows.length).toBe(2); // header + 1 log row
    expect(logRows[1][0]).toMatch(/^ML-/); // LogID
    expect(logRows[1][2]).toBe('A0001');   // MemberID at ML_MM_OFFSET
  });

  it('reuses existing familyID if member already has one', () => {
    seedMain(makeMainRow({ 8: 'B999' }));
    const res = JSON.parse(initiateSwitch(req({ memberID: 'A0001', email: 'alice@example.com', sessionID: 's1' })));
    expect(res.payload.familyID).toBe('B999');
  });
});

// ── initiateUpgrade ─────────────────────────────────────────

describe('initiateUpgrade', () => {
  beforeEach(() => {
    seedConfig();
    seedEmptyEvents();
    seedEmptyLog();
  });

  it('returns error when member not found', () => {
    seedMain(makeMainRow());
    const res = JSON.parse(initiateUpgrade(req({ memberID: 'ZZZZ', email: 'x@x.com', sessionID: 's1' })));
    expect(res.ok).toBe(false);
    expect(res.errorCode).toBe('NOT_FOUND');
  });

  it('returns error when status is pending_upgrade', () => {
    seedMain(makeMainRow({ 1: 'pending_upgrade' }));
    const res = JSON.parse(initiateUpgrade(req({ memberID: 'A0001', email: 'alice@example.com', sessionID: 's1' })));
    expect(res.ok).toBe(false);
    expect(res.errorCode).toBe('INVALID_STATE');
  });

  it('returns error when status is inactive (not active)', () => {
    const past = new Date();
    past.setFullYear(past.getFullYear() - 1);
    seedMain(makeMainRow({ 3: past.toISOString() }));
    const res = JSON.parse(initiateUpgrade(req({ memberID: 'A0001', email: 'alice@example.com', sessionID: 's1' })));
    expect(res.ok).toBe(false);
    expect(res.errorCode).toBe('INVALID_STATE');
  });

  it('returns error when member is already Family type', () => {
    seedMain(makeMainRow({ 7: 'Family', 8: 'B001' }));
    const res = JSON.parse(initiateUpgrade(req({ memberID: 'A0001', email: 'alice@example.com', sessionID: 's1' })));
    expect(res.ok).toBe(false);
    expect(res.errorCode).toBe('INVALID_STATE');
  });

  it('returns error when expiration is less than UpgradeMinMonths away', () => {
    // Expires in 2 months — below the 3-month threshold
    const twoMonths = new Date();
    twoMonths.setMonth(twoMonths.getMonth() + 2);
    seedMain(makeMainRow({ 3: twoMonths.toISOString() }));
    const res = JSON.parse(initiateUpgrade(req({ memberID: 'A0001', email: 'alice@example.com', sessionID: 's1' })));
    expect(res.ok).toBe(false);
    expect(res.errorCode).toBe('INVALID_STATE');
    expect(res.errorMessage).toMatch(/3 months/i);
  });

  it('succeeds when active Individual with expiration > 3 months', () => {
    // Expires in 6 months — well above threshold
    const sixMonths = new Date();
    sixMonths.setMonth(sixMonths.getMonth() + 6);
    seedMain(makeMainRow({ 3: sixMonths.toISOString() }));

    const res = JSON.parse(initiateUpgrade(req({ memberID: 'A0001', email: 'alice@example.com', sessionID: 's1' })));
    expect(res.ok).toBe(true);
    expect(res.payload.paymentIntent).toBe('Family Upgrade');
    expect(res.payload.amount).toBe(20);
    expect(res.payload.familyID).toMatch(/^B\d{3}/);
  });

  it('sets pending_upgrade and Family type in Main sheet', () => {
    const sixMonths = new Date();
    sixMonths.setMonth(sixMonths.getMonth() + 6);
    seedMain(makeMainRow({ 3: sixMonths.toISOString() }));

    initiateUpgrade(req({ memberID: 'A0001', email: 'alice@example.com', sessionID: 's1' }));
    const mainRows = __getSheet(MAIN);
    expect(mainRows[1][1]).toBe('pending_upgrade'); // STATUS
    expect(mainRows[1][7]).toBe('Family');           // TYPE
  });

  it('appends a family_upgrade event with Family Upgrade intent', () => {
    const sixMonths = new Date();
    sixMonths.setMonth(sixMonths.getMonth() + 6);
    seedMain(makeMainRow({ 3: sixMonths.toISOString() }));

    initiateUpgrade(req({ memberID: 'A0001', email: 'alice@example.com', sessionID: 's1' }));
    const evRows = __getSheet(EVENTS);
    expect(evRows.length).toBe(2);
    expect(evRows[1][1]).toBe('family_upgrade');  // WE_COL.EVENT_TYPE
    expect(evRows[1][6]).toBe('Family Upgrade');  // WE_COL.PAYMENT_INTENT
    expect(evRows[1][13]).toBe('Pending');         // WE_COL.STATUS
  });

  it('writes a log row before updating Main', () => {
    const sixMonths = new Date();
    sixMonths.setMonth(sixMonths.getMonth() + 6);
    seedMain(makeMainRow({ 3: sixMonths.toISOString() }));

    initiateUpgrade(req({ memberID: 'A0001', email: 'alice@example.com', sessionID: 's1' }));
    const logRows = __getSheet(LOG_SHEET);
    expect(logRows.length).toBe(2);
    expect(logRows[1][0]).toMatch(/^ML-/);
  });
});

// ── cancelUpgrade ───────────────────────────────────────────

describe('cancelUpgrade', () => {
  beforeEach(() => {
    seedConfig();
    seedEmptyLog();
  });

  it('returns error when member not found', () => {
    seedMain(makeMainRow());
    __seedSheet(EVENTS, [new Array(24).fill('')]);
    const res = JSON.parse(cancelUpgrade(req({ memberID: 'ZZZZ', email: 'x@x.com', sessionID: 's1' })));
    expect(res.ok).toBe(false);
    expect(res.errorCode).toBe('NOT_FOUND');
  });

  it('returns error when status is not pending_upgrade', () => {
    seedMain(makeMainRow({ 1: 'active' }));
    __seedSheet(EVENTS, [new Array(24).fill('')]);
    const res = JSON.parse(cancelUpgrade(req({ memberID: 'A0001', email: 'alice@example.com', sessionID: 's1' })));
    expect(res.ok).toBe(false);
    expect(res.errorCode).toBe('INVALID_STATE');
  });

  it('reverts the single member back to Individual with recalculated status (active)', () => {
    const future = new Date();
    future.setFullYear(future.getFullYear() + 1);
    seedMain(makeMainRow({ 1: 'pending_upgrade', 3: future.toISOString(), 7: 'Family', 8: 'B001' }));
    __seedSheet(EVENTS, [new Array(24).fill('')]);

    const res = JSON.parse(cancelUpgrade(req({ memberID: 'A0001', email: 'alice@example.com', sessionID: 's1' })));
    expect(res.ok).toBe(true);
    expect(res.payload.revertedCount).toBeGreaterThanOrEqual(1);

    const mainRows = __getSheet(MAIN);
    expect(mainRows[1][7]).toBe('Individual'); // TYPE reverted
    expect(mainRows[1][8]).toBe('');           // FAMILY_ID cleared
    expect(mainRows[1][1]).toBe('active');     // STATUS recalculated
  });

  it('recalculates status as inactive when expiration is past', () => {
    const past = new Date();
    past.setFullYear(past.getFullYear() - 1);
    seedMain(makeMainRow({ 1: 'pending_upgrade', 3: past.toISOString(), 7: 'Family', 8: 'B001' }));
    __seedSheet(EVENTS, [new Array(24).fill('')]);

    cancelUpgrade(req({ memberID: 'A0001', email: 'alice@example.com', sessionID: 's1' }));
    const mainRows = __getSheet(MAIN);
    expect(mainRows[1][1]).toBe('inactive');
  });

  it('reverts all family members sharing the same FamilyID', () => {
    const future = new Date();
    future.setFullYear(future.getFullYear() + 1);

    const member1 = makeMainRow({ 0: 'A0001', 1: 'pending_upgrade', 3: future.toISOString(), 7: 'Family', 8: 'B001' });
    const member2 = makeMainRow({ 0: 'A0002', 1: 'pending_upgrade', 3: future.toISOString(), 7: 'Family', 8: 'B001', 4: 'bob@example.com' });

    __seedSheet(MAIN, [new Array(23).fill(''), member1, member2]);
    __seedSheet(EVENTS, [new Array(24).fill('')]);

    const res = JSON.parse(cancelUpgrade(req({ memberID: 'A0001', email: 'alice@example.com', sessionID: 's1' })));
    expect(res.ok).toBe(true);
    expect(res.payload.revertedCount).toBe(2);

    const mainRows = __getSheet(MAIN);
    // Both members reverted
    expect(mainRows[1][7]).toBe('Individual');
    expect(mainRows[2][7]).toBe('Individual');
    expect(mainRows[1][8]).toBe('');
    expect(mainRows[2][8]).toBe('');
  });

  it('rejects pending family_switch / family_upgrade events for the member', () => {
    const future = new Date();
    future.setFullYear(future.getFullYear() + 1);
    seedMain(makeMainRow({ 1: 'pending_upgrade', 3: future.toISOString(), 7: 'Family', 8: 'B001' }));

    // Seed a pending family_switch event for A0001
    const evRow = new Array(24).fill('');
    evRow[0]  = 'EV001';          // WE_COL.EVENT_ID
    evRow[1]  = 'family_switch';  // WE_COL.EVENT_TYPE
    evRow[2]  = new Date().toISOString(); // WE_COL.TIMESTAMP
    evRow[4]  = 'A0001';          // WE_COL.MEMBER_ID
    evRow[13] = 'Pending';        // WE_COL.STATUS
    __seedSheet(EVENTS, [new Array(24).fill(''), evRow]);

    cancelUpgrade(req({ memberID: 'A0001', email: 'alice@example.com', sessionID: 's1' }));

    const evRows = __getSheet(EVENTS);
    // The event row should now be Rejected
    expect(evRows[1][13]).toBe('Rejected');
    expect(evRows[1][16]).toBe('system'); // ADMIN_APPROVER
  });

  it('writes a log row for each reverted member', () => {
    const future = new Date();
    future.setFullYear(future.getFullYear() + 1);
    const member1 = makeMainRow({ 0: 'A0001', 1: 'pending_upgrade', 3: future.toISOString(), 7: 'Family', 8: 'B001' });
    const member2 = makeMainRow({ 0: 'A0002', 1: 'pending_upgrade', 3: future.toISOString(), 7: 'Family', 8: 'B001', 4: 'bob@example.com' });
    __seedSheet(MAIN, [new Array(23).fill(''), member1, member2]);
    __seedSheet(EVENTS, [new Array(24).fill('')]);

    cancelUpgrade(req({ memberID: 'A0001', email: 'alice@example.com', sessionID: 's1' }));
    const logRows = __getSheet(LOG_SHEET);
    // header + 2 log rows (one per member)
    expect(logRows.length).toBe(3);
  });
});

export {};
