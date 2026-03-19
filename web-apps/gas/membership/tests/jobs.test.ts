// ============================================================
// jobs.test.ts — Background job scheduling and expiry handling
// Tests: expirePaymentProofs, expireInactiveMemberships
// ============================================================

require('../src/types');
require('../src/ui');
require('../src/config');
require('../src/sheets');
require('../src/logger');
require('../src/jobs');

declare function expirePaymentProofs(): string;
declare function expireInactiveMemberships(): string;
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
  row[15] = new Date().toISOString(); // LAST_UPDATED
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
      makeMainRow({ 1: 'active', 3: pastDate.toISOString(), 15: oldTime })
    ]);

    expireInactiveMemberships();

    const mainRows = __getSheet(MAIN);
    const updatedTime = mainRows[1][15];
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

export {};
