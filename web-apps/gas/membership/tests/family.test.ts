// ============================================================
// family.ts — unit tests
// Covers: getFamilyMembers, addFamilyMember, removeFamilyMember
// ============================================================

require('../src/types');
require('../src/ui');
require('../src/config');
require('../src/sheets');
require('../src/logger');
require('../src/family');

declare function getFamilyMembers(jsonRequest: string): string;
declare function addFamilyMember(jsonRequest: string): string;
declare function removeFamilyMember(jsonRequest: string): string;
declare function __seedSheet(name: string, rows: any[][]): void;
declare function __getSheet(name: string): any[][];
declare function findMemberByID(id: string): any;
declare function getMembersByFamilyID(id: string): any[];
declare function logMainTableRow(memberID: string): void;
declare function updateMemberRow(idx: number, updates: any): void;
declare function findMemberByEmail(email: string): any;
declare function auditLog(action: string, data?: any): void;

// ── Shared helpers ──────────────────────────────────────────

const MAIN   = 'Main';
const LOG_SHEET = 'Membership-Master-Log';
const CONFIG = 'Config';

function seedConfig(): void {
  __seedSheet(CONFIG, [
    ['Key', 'Value', 'Description'],
    ['MembershipRenewalYears', '1', ''],
  ]);
}

function seedEmptyLog(): void {
  __seedSheet(LOG_SHEET, [new Array(25).fill('')]);
}

/** 23-column Main row with sensible defaults. */
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

function req(payload: object): string {
  return JSON.stringify({ requestId: 'test-req', payload });
}

// ── getFamilyMembers ────────────────────────────────────────

describe('getFamilyMembers', () => {
  beforeEach(() => seedConfig());

  it('returns error when acting member not found', () => {
    __seedSheet(MAIN, [new Array(23).fill('')]);
    const res = JSON.parse(getFamilyMembers(req({ memberID: 'A9999', sessionID: 's1' })));
    expect(res.ok).toBe(false);
    expect(res.errorCode).toBe('NOT_FOUND');
  });

  it('returns error when acting member is Individual type', () => {
    __seedSheet(MAIN, [new Array(23).fill(''), makeMainRow({ 7: 'Individual' })]);
    const res = JSON.parse(getFamilyMembers(req({ memberID: 'A0001', sessionID: 's1' })));
    expect(res.ok).toBe(false);
    expect(res.errorCode).toBe('INVALID_STATE');
  });

  it('returns empty members array when Family member has no FamilyID', () => {
    __seedSheet(MAIN, [new Array(23).fill(''), makeMainRow({ 7: 'Family', 8: '' })]);
    const res = JSON.parse(getFamilyMembers(req({ memberID: 'A0001', sessionID: 's1' })));
    expect(res.ok).toBe(true);
    expect(res.payload.members).toEqual([]);
  });

  it('returns all members sharing the same FamilyID', () => {
    const future = new Date();
    future.setFullYear(future.getFullYear() + 1);

    const actor  = makeMainRow({ 0: 'A0001', 7: 'Family', 8: 'B001' });
    const member2 = makeMainRow({ 0: 'A0002', 7: 'Family', 8: 'B001', 4: 'bob@example.com' });
    const member3 = makeMainRow({ 0: 'A0003', 7: 'Family', 8: 'B001', 4: 'carol@example.com' });
    const other   = makeMainRow({ 0: 'A0004', 7: 'Individual', 8: '' });

    __seedSheet(MAIN, [new Array(23).fill(''), actor, member2, member3, other]);

    const res = JSON.parse(getFamilyMembers(req({ memberID: 'A0001', sessionID: 's1' })));
    expect(res.ok).toBe(true);
    const ids = res.payload.members.map((m: any) => m.memberID);
    expect(ids).toContain('A0001');
    expect(ids).toContain('A0002');
    expect(ids).toContain('A0003');
    expect(ids).not.toContain('A0004');
    expect(res.payload.familyID).toBe('B001');
  });
});

// ── addFamilyMember ─────────────────────────────────────────

describe('addFamilyMember', () => {
  beforeEach(() => {
    seedConfig();
    seedEmptyLog();
  });

  it('returns error when acting member not found', () => {
    __seedSheet(MAIN, [new Array(23).fill('')]);
    const res = JSON.parse(addFamilyMember(req({ memberID: 'A9999', targetEmail: 'bob@example.com', sessionID: 's1' })));
    expect(res.ok).toBe(false);
    expect(res.errorCode).toBe('NOT_FOUND');
  });

  it('returns error when acting member is not Family type', () => {
    __seedSheet(MAIN, [new Array(23).fill(''), makeMainRow({ 7: 'Individual' })]);
    const res = JSON.parse(addFamilyMember(req({ memberID: 'A0001', targetEmail: 'bob@example.com', sessionID: 's1' })));
    expect(res.ok).toBe(false);
    expect(res.errorCode).toBe('INVALID_STATE');
  });

  it('returns error when acting member has no FamilyID', () => {
    __seedSheet(MAIN, [new Array(23).fill(''), makeMainRow({ 7: 'Family', 8: '' })]);
    const res = JSON.parse(addFamilyMember(req({ memberID: 'A0001', targetEmail: 'bob@example.com', sessionID: 's1' })));
    expect(res.ok).toBe(false);
    expect(res.errorCode).toBe('INVALID_STATE');
  });

  it('returns NOT_FOUND when target email does not exist', () => {
    __seedSheet(MAIN, [new Array(23).fill(''), makeMainRow({ 7: 'Family', 8: 'B001' })]);
    const res = JSON.parse(addFamilyMember(req({ memberID: 'A0001', targetEmail: 'nobody@example.com', sessionID: 's1' })));
    expect(res.ok).toBe(false);
    expect(res.errorCode).toBe('NOT_FOUND');
  });

  it('returns CONFLICT when target already belongs to a different family', () => {
    const actor  = makeMainRow({ 0: 'A0001', 7: 'Family', 8: 'B001' });
    const target = makeMainRow({ 0: 'A0002', 7: 'Family', 8: 'B999', 4: 'bob@example.com' });
    __seedSheet(MAIN, [new Array(23).fill(''), actor, target]);

    const res = JSON.parse(addFamilyMember(req({ memberID: 'A0001', targetEmail: 'bob@example.com', sessionID: 's1' })));
    expect(res.ok).toBe(false);
    expect(res.errorCode).toBe('CONFLICT');
  });

  it('returns INVALID_STATE when trying to add yourself', () => {
    __seedSheet(MAIN, [new Array(23).fill(''), makeMainRow({ 7: 'Family', 8: 'B001' })]);
    const res = JSON.parse(addFamilyMember(req({ memberID: 'A0001', targetEmail: 'alice@example.com', sessionID: 's1' })));
    expect(res.ok).toBe(false);
    expect(res.errorCode).toBe('INVALID_STATE');
  });

  it('sets target TYPE = Family and FAMILY_ID when actor is active', () => {
    const actor  = makeMainRow({ 0: 'A0001', 7: 'Family', 8: 'B001' });
    const target = makeMainRow({ 0: 'A0002', 7: 'Individual', 8: '', 4: 'bob@example.com' });
    __seedSheet(MAIN, [new Array(23).fill(''), actor, target]);

    const res = JSON.parse(addFamilyMember(req({ memberID: 'A0001', targetEmail: 'bob@example.com', sessionID: 's1' })));
    expect(res.ok).toBe(true);

    const mainRows = __getSheet(MAIN);
    const targetRow = mainRows[2];
    expect(targetRow[7]).toBe('Family');  // TYPE
    expect(targetRow[8]).toBe('B001');    // FAMILY_ID
  });

  it('sets target EXPIRATION = yesterday and STATUS = pending_upgrade when actor is pending_upgrade', () => {
    const actor  = makeMainRow({ 0: 'A0001', 1: 'pending_upgrade', 7: 'Family', 8: 'B001' });
    const target = makeMainRow({ 0: 'A0002', 7: 'Individual', 8: '', 4: 'bob@example.com' });
    __seedSheet(MAIN, [new Array(23).fill(''), actor, target]);

    addFamilyMember(req({ memberID: 'A0001', targetEmail: 'bob@example.com', sessionID: 's1' }));

    const mainRows = __getSheet(MAIN);
    const targetRow = mainRows[2];

    // EXPIRATION should be yesterday
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yStr = yesterday.toISOString().split('T')[0];
    expect(targetRow[3]).toBe(yStr); // EXPIRATION

    expect(targetRow[1]).toBe('pending_upgrade'); // STATUS
    expect(targetRow[7]).toBe('Family');           // TYPE
    expect(targetRow[8]).toBe('B001');             // FAMILY_ID
  });

  it('does NOT set yesterday expiration when actor status is active', () => {
    const actor  = makeMainRow({ 0: 'A0001', 1: 'active', 7: 'Family', 8: 'B001' });
    const future = new Date();
    future.setFullYear(future.getFullYear() + 2);
    const target = makeMainRow({ 0: 'A0002', 7: 'Individual', 8: '', 4: 'bob@example.com', 3: future.toISOString() });
    __seedSheet(MAIN, [new Array(23).fill(''), actor, target]);

    addFamilyMember(req({ memberID: 'A0001', targetEmail: 'bob@example.com', sessionID: 's1' }));

    const mainRows = __getSheet(MAIN);
    // Target expiration should NOT be yesterday
    const targetExp = new Date(mainRows[2][3]);
    expect(targetExp.getTime()).toBeGreaterThan(Date.now());
  });

  it('writes a log row before updating the target member', () => {
    const actor  = makeMainRow({ 0: 'A0001', 7: 'Family', 8: 'B001' });
    const target = makeMainRow({ 0: 'A0002', 7: 'Individual', 8: '', 4: 'bob@example.com' });
    __seedSheet(MAIN, [new Array(23).fill(''), actor, target]);

    addFamilyMember(req({ memberID: 'A0001', targetEmail: 'bob@example.com', sessionID: 's1' }));

    const logRows = __getSheet(LOG_SHEET);
    expect(logRows.length).toBe(2); // header + 1 log row
    expect(logRows[1][0]).toMatch(/^ML-/);
    expect(logRows[1][2]).toBe('A0002'); // logged the TARGET's memberID
  });

  it('allows re-adding a member already in the same family (idempotent)', () => {
    const actor   = makeMainRow({ 0: 'A0001', 7: 'Family', 8: 'B001' });
    const inFamily = makeMainRow({ 0: 'A0002', 7: 'Family', 8: 'B001', 4: 'bob@example.com' });
    __seedSheet(MAIN, [new Array(23).fill(''), actor, inFamily]);

    const res = JSON.parse(addFamilyMember(req({ memberID: 'A0001', targetEmail: 'bob@example.com', sessionID: 's1' })));
    expect(res.ok).toBe(true);
  });
});

// ── removeFamilyMember ──────────────────────────────────────

describe('removeFamilyMember', () => {
  beforeEach(() => {
    seedConfig();
    seedEmptyLog();
  });

  it('returns error when acting member not found', () => {
    __seedSheet(MAIN, [new Array(23).fill('')]);
    const res = JSON.parse(removeFamilyMember(req({ memberID: 'A9999', targetEmail: 'bob@example.com', sessionID: 's1' })));
    expect(res.ok).toBe(false);
    expect(res.errorCode).toBe('NOT_FOUND');
  });

  it('returns error when acting member is not Family type', () => {
    __seedSheet(MAIN, [new Array(23).fill(''), makeMainRow({ 7: 'Individual' })]);
    const res = JSON.parse(removeFamilyMember(req({ memberID: 'A0001', targetEmail: 'bob@example.com', sessionID: 's1' })));
    expect(res.ok).toBe(false);
    expect(res.errorCode).toBe('INVALID_STATE');
  });

  it('returns NOT_FOUND when target email does not exist', () => {
    __seedSheet(MAIN, [new Array(23).fill(''), makeMainRow({ 7: 'Family', 8: 'B001' })]);
    const res = JSON.parse(removeFamilyMember(req({ memberID: 'A0001', targetEmail: 'nobody@example.com', sessionID: 's1' })));
    expect(res.ok).toBe(false);
    expect(res.errorCode).toBe('NOT_FOUND');
  });

  it('returns INVALID_STATE when trying to remove yourself', () => {
    __seedSheet(MAIN, [new Array(23).fill(''), makeMainRow({ 7: 'Family', 8: 'B001' })]);
    const res = JSON.parse(removeFamilyMember(req({ memberID: 'A0001', targetEmail: 'alice@example.com', sessionID: 's1' })));
    expect(res.ok).toBe(false);
    expect(res.errorCode).toBe('INVALID_STATE');
  });

  it('returns CONFLICT when target is not in the same family', () => {
    const actor  = makeMainRow({ 0: 'A0001', 7: 'Family', 8: 'B001' });
    const target = makeMainRow({ 0: 'A0002', 7: 'Family', 8: 'B999', 4: 'bob@example.com' });
    __seedSheet(MAIN, [new Array(23).fill(''), actor, target]);

    const res = JSON.parse(removeFamilyMember(req({ memberID: 'A0001', targetEmail: 'bob@example.com', sessionID: 's1' })));
    expect(res.ok).toBe(false);
    expect(res.errorCode).toBe('CONFLICT');
  });

  it('reverts target to Individual and clears FamilyID', () => {
    const actor  = makeMainRow({ 0: 'A0001', 7: 'Family', 8: 'B001' });
    const target = makeMainRow({ 0: 'A0002', 7: 'Family', 8: 'B001', 4: 'bob@example.com' });
    __seedSheet(MAIN, [new Array(23).fill(''), actor, target]);

    const res = JSON.parse(removeFamilyMember(req({ memberID: 'A0001', targetEmail: 'bob@example.com', sessionID: 's1' })));
    expect(res.ok).toBe(true);

    const mainRows = __getSheet(MAIN);
    const targetRow = mainRows[2];
    expect(targetRow[7]).toBe('Individual'); // TYPE
    expect(targetRow[8]).toBe('');           // FAMILY_ID cleared
  });

  it('recalculates removed member status as active when expiration is future', () => {
    const future = new Date();
    future.setFullYear(future.getFullYear() + 1);

    const actor  = makeMainRow({ 0: 'A0001', 7: 'Family', 8: 'B001' });
    const target = makeMainRow({ 0: 'A0002', 7: 'Family', 8: 'B001', 4: 'bob@example.com', 3: future.toISOString() });
    __seedSheet(MAIN, [new Array(23).fill(''), actor, target]);

    removeFamilyMember(req({ memberID: 'A0001', targetEmail: 'bob@example.com', sessionID: 's1' }));

    const mainRows = __getSheet(MAIN);
    expect(mainRows[2][1]).toBe('active');
  });

  it('recalculates removed member status as inactive when expiration is past', () => {
    const past = new Date();
    past.setFullYear(past.getFullYear() - 1);

    const actor  = makeMainRow({ 0: 'A0001', 7: 'Family', 8: 'B001' });
    const target = makeMainRow({ 0: 'A0002', 7: 'Family', 8: 'B001', 4: 'bob@example.com', 3: past.toISOString() });
    __seedSheet(MAIN, [new Array(23).fill(''), actor, target]);

    removeFamilyMember(req({ memberID: 'A0001', targetEmail: 'bob@example.com', sessionID: 's1' }));

    const mainRows = __getSheet(MAIN);
    expect(mainRows[2][1]).toBe('inactive');
  });

  it('writes a log row before updating the target member', () => {
    const actor  = makeMainRow({ 0: 'A0001', 7: 'Family', 8: 'B001' });
    const target = makeMainRow({ 0: 'A0002', 7: 'Family', 8: 'B001', 4: 'bob@example.com' });
    __seedSheet(MAIN, [new Array(23).fill(''), actor, target]);

    removeFamilyMember(req({ memberID: 'A0001', targetEmail: 'bob@example.com', sessionID: 's1' }));

    const logRows = __getSheet(LOG_SHEET);
    expect(logRows.length).toBe(2); // header + 1 log row
    expect(logRows[1][2]).toBe('A0002'); // logged the TARGET's memberID
  });

  it('does not modify the acting member row', () => {
    const actor  = makeMainRow({ 0: 'A0001', 7: 'Family', 8: 'B001' });
    const target = makeMainRow({ 0: 'A0002', 7: 'Family', 8: 'B001', 4: 'bob@example.com' });
    __seedSheet(MAIN, [new Array(23).fill(''), actor, target]);

    removeFamilyMember(req({ memberID: 'A0001', targetEmail: 'bob@example.com', sessionID: 's1' }));

    const mainRows = __getSheet(MAIN);
    // Actor row unchanged
    expect(mainRows[1][7]).toBe('Family');
    expect(mainRows[1][8]).toBe('B001');
  });
});

export {};
