// Tests for members.ts — profile creation and updates

require('../src/types');
require('../src/config');
require('../src/sheets');
require('../src/logger');
require('../src/members');

declare function getOrCreateMemberProfile(jsonRequest: string): string;
declare function updateMemberProfile(jsonRequest: string): string;
declare function __seedSheet(name: string, rows: any[][]): void;
declare function __getSheet(name: string): any[][];

const MM = 'Membership-Master-Main-3';
const LOG = 'WebApp-ActivityLog';
const CFG = 'Config';

function blankRow(len = 23) { return new Array(len).fill(''); }
function req(payload: any): string {
  return JSON.stringify({ requestId: 'test-req', payload });
}

describe('getOrCreateMemberProfile', () => {
  beforeEach(() => {
    __seedSheet(CFG, [['Key', 'Value', 'Desc']]);
    __seedSheet(LOG, [[]]);
  });

  it('creates a new inactive member for unknown email', () => {
    __seedSheet(MM, [blankRow()]);
    const res = JSON.parse(getOrCreateMemberProfile(req({ email: 'new@example.com', sessionID: 'S1' })));
    expect(res.ok).toBe(true);
    expect(res.payload.member.email).toBe('new@example.com');
    expect(res.payload.member.status).toBe('not active');
    expect(res.payload.member.memberID).toMatch(/^A\d{4}$/);
  });

  it('returns existing member without creating a duplicate', () => {
    const row = blankRow();
    row[0] = 'A0010'; row[4] = 'existing@example.com'; row[1] = 'active';
    __seedSheet(MM, [blankRow(), row]);
    const res = JSON.parse(getOrCreateMemberProfile(req({ email: 'existing@example.com', sessionID: 'S1' })));
    expect(res.ok).toBe(true);
    expect(res.payload.member.memberID).toBe('A0010');
    // Ensure no duplicate was created
    expect(__getSheet(MM)).toHaveLength(2);
  });

  it('sets joinYear to current year for new member', () => {
    __seedSheet(MM, [blankRow()]);
    const res = JSON.parse(getOrCreateMemberProfile(req({ email: 'brand@new.com', sessionID: 'S1' })));
    expect(res.payload.member.joinYear).toBe(String(new Date().getFullYear()));
  });
});

describe('updateMemberProfile', () => {
  beforeEach(() => {
    __seedSheet(LOG, [[]]);
    const row = blankRow();
    row[0] = 'A0001'; row[4] = 'user@test.com'; row[5] = 'Jane'; row[6] = 'Doe';
    __seedSheet(MM, [blankRow(), row]);
  });

  it('returns NOT_FOUND for unknown MemberID', () => {
    const res = JSON.parse(updateMemberProfile(req({ memberID: 'A9999', firstName: 'Test' })));
    expect(res.ok).toBe(false);
    expect(res.errorCode).toBe('NOT_FOUND');
  });

  it('updates allowed fields', () => {
    const res = JSON.parse(updateMemberProfile(req({
      memberID: 'A0001',
      firstName: 'Janet',
      phoneNumber: '917-555-0000',
      district: 'Queens',
      joinYear: '2020',
    })));
    expect(res.ok).toBe(true);
    expect(res.payload.member.firstName).toBe('Janet');
    expect(res.payload.member.phoneNumber).toBe('917-555-0000');
    expect(res.payload.member.district).toBe('Queens');
    expect(res.payload.member.joinYear).toBe('2020');
  });

  it('does not overwrite fields that are not provided', () => {
    const res = JSON.parse(updateMemberProfile(req({
      memberID: 'A0001',
      district: 'Brooklyn',
    })));
    // firstName should still be Jane (unchanged)
    expect(res.payload.member.firstName).toBe('Jane');
    expect(res.payload.member.district).toBe('Brooklyn');
  });
});
