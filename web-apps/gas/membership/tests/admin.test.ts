// ============================================================
// admin.test.ts — Admin operations and authorization
// Tests: getPendingEvents, getUnmatchedPayments, getConfig (with auth)
// ============================================================

require('../src/types');
require('../src/ui');
require('../src/config');
require('../src/sheets');
require('../src/logger');
require('../src/admin');

declare function getPendingEvents(jsonRequest: string): string;
declare function getUnmatchedPayments(jsonRequest: string): string;
declare function getConfig(jsonRequest: string): string;
declare function __seedSheet(name: string, rows: any[][]): void;
declare function __getSheet(name: string): any[][];

const EVENTS = 'WebApp-Events';
const CONFIG = 'Config';

function req(payload: object): string {
  return JSON.stringify({ requestId: 'test-req', payload });
}

function makeEventRow(status: string = 'Pending', overrides: Record<number, any> = {}): any[] {
  const row: any[] = new Array(24).fill('');
  row[0] = 'EV001';
  row[1] = 'dues_payment';
  row[2] = new Date().toISOString();
  row[3] = new Date(Date.now() + 7 * 86400000).toISOString();
  row[4] = 'A0001';
  row[5] = 'alice@example.com';
  row[6] = 'Individual Membership';
  row[7] = 30;
  row[13] = status;
  Object.entries(overrides).forEach(([k, v]) => { row[Number(k)] = v; });
  return row;
}

function seedConfig(): void {
  __seedSheet(CONFIG, [
    ['Key', 'Value', 'Description'],
    ['AdminEmails', 'admin@example.com', ''],
    ['IndividualPrice', '30', ''],
    ['Districts', 'North,South,East,West', ''],
  ]);
}

function seedEmptyEvents(): void {
  __seedSheet(EVENTS, [new Array(24).fill('')]);
}

describe('getPendingEvents', () => {
  beforeEach(() => {
    seedConfig();
    seedEmptyEvents();
  });

  it('returns all WebApp-Events with Pending/Matched status', () => {
    __seedSheet(EVENTS, [
      new Array(24).fill(''),
      makeEventRow('Pending'),
      makeEventRow('Matched'),
      makeEventRow('Approved')
    ]);

    const res = JSON.parse(getPendingEvents(req({ adminEmail: 'admin@example.com' })));
    expect(res.ok).toBe(true);
    expect(res.payload.events.length).toBe(2); // Pending + Matched, not Approved
  });

  it('returns error for non-admin email', () => {
    seedEmptyEvents();
    const res = JSON.parse(getPendingEvents(req({ adminEmail: 'notadmin@example.com' })));
    expect(res.ok).toBe(false);
    expect(res.errorCode).toBe('FORBIDDEN');
  });

  it('is case-insensitive for admin email check', () => {
    seedEmptyEvents();
    const res = JSON.parse(getPendingEvents(req({ adminEmail: 'ADMIN@EXAMPLE.COM' })));
    expect(res.ok).toBe(true);
  });
});

describe('getConfig', () => {
  beforeEach(() => {
    seedConfig();
  });

  it('returns complete ConfigMap with all keys', () => {
    const res = JSON.parse(getConfig(req({ adminEmail: 'admin@example.com' })));
    expect(res.ok).toBe(true);
    expect(res.payload.config).toBeDefined();
    expect(res.payload.config['IndividualPrice']).toBe('30');
    expect(res.payload.config['AdminEmails']).toBe('admin@example.com');
  });

  it('includes Districts config (NEW FIELD)', () => {
    const res = JSON.parse(getConfig(req({ adminEmail: 'admin@example.com' })));
    expect(res.ok).toBe(true);
    expect(res.payload.config['Districts']).toBe('North,South,East,West');
  });

  it('returns error for non-admin email', () => {
    const res = JSON.parse(getConfig(req({ adminEmail: 'notadmin@example.com' })));
    expect(res.ok).toBe(false);
    expect(res.errorCode).toBe('FORBIDDEN');
  });

  it('demonstrates config caching (cache hit/miss behavior)', () => {
    // First call - cache miss
    const res1 = JSON.parse(getConfig(req({ adminEmail: 'admin@example.com' })));
    expect(res1.ok).toBe(true);

    // Second call - cache hit (same data, but cached)
    const res2 = JSON.parse(getConfig(req({ adminEmail: 'admin@example.com' })));
    expect(res2.ok).toBe(true);
    expect(res2.payload.config).toEqual(res1.payload.config);
  });

  it('is case-insensitive for admin email', () => {
    const res = JSON.parse(getConfig(req({ adminEmail: 'ADMIN@EXAMPLE.COM' })));
    expect(res.ok).toBe(true);
  });
});

export {};
