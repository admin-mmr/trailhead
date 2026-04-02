// ============================================================
// sheets.ts — unit tests
// Covers: deriveStatus, rowToMember, logMainTableRow,
//         generateMemberID, generateFamilyID, findMemberByEmail,
//         findMemberByID, findMembersByFamilyID, updateMemberRow
// ============================================================

require('../src/types');
require('../src/ui');
require('../src/config');
require('../src/sheets');

declare function deriveStatus(expiration: string): string;
declare function rowToMember(row: any[]): any;
declare function logMainTableRow(memberID: string): void;
declare function findMemberByEmail(email: string): any;
declare function findMemberByID(id: string): any;
declare function generateMemberID(): string;
declare function generateFamilyID(): string;
declare function __seedSheet(name: string, rows: any[][]): void;
declare function __getSheet(name: string): any[][];

// --------------- deriveStatus ---------------

describe('deriveStatus', () => {
  it('returns inactive for blank expiration', () => {
    expect(deriveStatus('')).toBe('inactive');
  });

  it('returns inactive for invalid date', () => {
    expect(deriveStatus('not-a-date')).toBe('inactive');
  });

  it('returns active for future expiration', () => {
    const future = new Date();
    future.setFullYear(future.getFullYear() + 1);
    expect(deriveStatus(future.toISOString())).toBe('active');
  });

  it('returns inactive for past expiration', () => {
    const past = new Date();
    past.setFullYear(past.getFullYear() - 1);
    expect(deriveStatus(past.toISOString())).toBe('inactive');
  });

  it('returns active for today (same day)', () => {
    const today = new Date();
    today.setHours(12, 0, 0, 0);
    expect(deriveStatus(today.toISOString())).toBe('active');
  });

  // Legacy values 'expired' and 'not active' must NOT be returned
  it('never returns legacy status strings', () => {
    const result = deriveStatus(new Date().toISOString());
    expect(['active', 'inactive']).toContain(result);
  });
});

// --------------- rowToMember ---------------

describe('rowToMember', () => {
  function makeRow(overrides: Record<number, any> = {}): any[] {
    const future = new Date();
    future.setFullYear(future.getFullYear() + 1);
    const row: any[] = new Array(23).fill('');
    row[0]  = 'A0001';   // MEMBER_ID
    row[1]  = 'active';  // STATUS
    row[3]  = future.toISOString(); // EXPIRATION
    row[4]  = 'test@example.com';
    row[5]  = 'Jane';
    row[6]  = 'Doe';
    row[7]  = 'Individual';
    Object.entries(overrides).forEach(([k, v]) => { row[Number(k)] = v; });
    return row;
  }

  it('derives active from future expiration (stored status ignored for active/inactive)', () => {
    const m = rowToMember(makeRow({ 1: 'active' }));
    expect(m.status).toBe('active');
    expect(m.memberID).toBe('A0001');
  });

  it('derives inactive when expiration is in the past regardless of stored status', () => {
    const past = new Date();
    past.setFullYear(past.getFullYear() - 1);
    const m = rowToMember(makeRow({ 1: 'active', 3: past.toISOString() }));
    expect(m.status).toBe('inactive');
  });

  it('returns pending_upgrade when stored status = pending_upgrade', () => {
    const m = rowToMember(makeRow({ 1: 'pending_upgrade' }));
    expect(m.status).toBe('pending_upgrade');
  });

  it('handles legacy "not active" stored status as inactive', () => {
    const past = new Date();
    past.setFullYear(past.getFullYear() - 1);
    const m = rowToMember(makeRow({ 1: 'not active', 3: past.toISOString() }));
    expect(m.status).toBe('inactive');
  });

  it('handles legacy "expired" stored status as inactive', () => {
    const past = new Date();
    past.setFullYear(past.getFullYear() - 1);
    const m = rowToMember(makeRow({ 1: 'expired', 3: past.toISOString() }));
    expect(m.status).toBe('inactive');
  });

  it('maps all fields correctly', () => {
    const m = rowToMember(makeRow({ 5: 'Alice', 6: 'Smith', 7: 'Family', 8: 'B001' }));
    expect(m.firstName).toBe('Alice');
    expect(m.lastName).toBe('Smith');
    expect(m.type).toBe('Family');
    expect(m.familyID).toBe('B001');
  });
});

// --------------- logMainTableRow ---------------

describe('logMainTableRow', () => {
  const MAIN  = 'Main';
  const LOG   = 'Membership-Master-Log';

  beforeEach(() => {
    const future = new Date();
    future.setFullYear(future.getFullYear() + 1);
    // Header row + one member row
    __seedSheet(MAIN, [
      ['MemberID','Status','Created','Expiration','Email','FirstName','LastName',
       'Type','FamilyID','Gender','WeChatID','District','Info',
       'LastUpdated','MembershipFeePaid','PaymentDate','PaymentTransaction',
       'JoinYear','PhoneNumber','LastLogin','Notes'],
      ['A0001', 'active', '', future.toISOString(), 'a@example.com',
       'Ann', 'Lee', 'Individual', '', '', '', '',
       '', '', '', '', '2022', '', '', ''],
    ]);
    __seedSheet(LOG, [
      ['LogID','LoggingTime',
       'MemberID','Status','Created','Expiration','Email','FirstName','LastName',
       'Type','FamilyID','Gender','WeChatID','District','Info',
       'LastUpdated','MembershipFeePaid','PaymentDate','PaymentTransaction',
       'JoinYear','PhoneNumber','LastLogin','Notes'],
    ]);
  });

  it('appends a log row before a write', () => {
    logMainTableRow('A0001');
    const logRows = __getSheet(LOG);
    expect(logRows.length).toBe(2); // header + 1 log row
    const logRow = logRows[1];
    expect(logRow[0]).toMatch(/^ML-/);           // LogID
    expect(typeof logRow[1]).toBe('string');      // LoggingTime
    expect(logRow[2]).toBe('A0001');              // MemberID (offset +2)
  });

  it('does not throw when member not found', () => {
    expect(() => logMainTableRow('NOTEXIST')).not.toThrow();
    const logRows = __getSheet(LOG);
    expect(logRows.length).toBe(1); // only header, no row added
  });
});

// --------------- findMemberByEmail / findMemberByID ---------------

describe('findMemberByEmail', () => {
  beforeEach(() => {
    const future = new Date();
    future.setFullYear(future.getFullYear() + 1);
    __seedSheet('Main', [
      new Array(23).fill(''), // header row (simplified)
      (() => {
        const r = new Array(23).fill('');
        r[0] = 'A0001'; r[4] = 'user@example.com'; r[3] = future.toISOString(); return r;
      })(),
    ]);
  });

  it('finds member by email (case-insensitive)', () => {
    const result = findMemberByEmail('USER@EXAMPLE.COM');
    expect(result).not.toBeNull();
    expect(result!.member.memberID).toBe('A0001');
  });

  it('returns null when email not found', () => {
    expect(findMemberByEmail('nobody@example.com')).toBeNull();
  });
});

describe('findMemberByID', () => {
  beforeEach(() => {
    const future = new Date();
    future.setFullYear(future.getFullYear() + 1);
    __seedSheet('Main', [
      new Array(23).fill(''),
      (() => {
        const r = new Array(23).fill('');
        r[0] = 'A0042'; r[4] = 'x@x.com'; r[3] = future.toISOString(); return r;
      })(),
    ]);
  });

  it('finds member by ID', () => {
    const result = findMemberByID('A0042');
    expect(result).not.toBeNull();
    expect(result!.member.email).toBe('x@x.com');
  });

  it('returns null when ID not found', () => {
    expect(findMemberByID('A9999')).toBeNull();
  });
});

// --------------- generateMemberID / generateFamilyID ---------------

describe('generateMemberID', () => {
  it('returns A0001 for an empty sheet', () => {
    __seedSheet('Main', [new Array(23).fill('')]);
    expect(generateMemberID()).toBe('A0001');
  });

  it('skips used IDs and returns first available', () => {
    const used = new Array(23).fill('');
    used[0] = 'A0001';
    __seedSheet('Main', [new Array(23).fill(''), used]);
    expect(generateMemberID()).toBe('A0002');
  });
});

describe('generateFamilyID', () => {
  it('returns B001 for an empty sheet', () => {
    __seedSheet('Main', [new Array(23).fill('')]);
    expect(generateFamilyID()).toBe('B001');
  });

  it('skips used FamilyIDs', () => {
    const used = new Array(23).fill('');
    used[8] = 'B001';
    __seedSheet('Main', [new Array(23).fill(''), used]);
    expect(generateFamilyID()).toBe('B002');
  });
});

export {};
