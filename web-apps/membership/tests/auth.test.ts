// Tests for auth.ts — OTP creation, verification, Google login

require('../src/types');
require('../src/config');
require('../src/sheets');
require('../src/logger');
require('../src/members');
require('../src/auth');

declare function requestEmailOtp(jsonRequest: string): string;
declare function verifyEmailOtp(jsonRequest: string): string;
declare function handleGoogleLogin(jsonRequest: string): string;
declare function __seedSheet(name: string, rows: any[][]): void;
declare function __getSheet(name: string): any[][];

const MM = 'Membership-Master-Main-3';
const OTP = 'Auth-OTP';
const LOG = 'WebApp-ActivityLog';
const CFG = 'Config';

function blankRow(len = 23) { return new Array(len).fill(''); }

function req(payload: any): string {
  return JSON.stringify({ requestId: 'test-req', payload });
}

describe('requestEmailOtp', () => {
  beforeEach(() => {
    __seedSheet(CFG, [['Key', 'Value', 'Desc'], ['OTP_Valid_Hours', '24', ''], ['OTP_Cleanup_Days', '7', '']]);
    __seedSheet(OTP, [['Email', 'Code', 'CreatedAt', 'ExpiresAt', 'Used', 'IP']]);
    __seedSheet(LOG, [[]]);
  });

  it('rejects invalid email', () => {
    const res = JSON.parse(requestEmailOtp(req({ email: 'notanemail', sessionID: 'S1' })));
    expect(res.ok).toBe(false);
    expect(res.errorCode).toBe('INVALID_EMAIL');
  });

  it('sends OTP and appends to sheet', () => {
    const res = JSON.parse(requestEmailOtp(req({ email: 'user@yahoo.com', sessionID: 'S1' })));
    expect(res.ok).toBe(true);
    const rows = __getSheet(OTP);
    expect(rows).toHaveLength(2); // header + new OTP row
    expect(rows[1][0]).toBe('user@yahoo.com');
    expect(rows[1][4]).toBe(false); // not used
  });
});

describe('verifyEmailOtp', () => {
  beforeEach(() => {
    __seedSheet(CFG, [['Key', 'Value', 'Desc']]);
    __seedSheet(MM, [blankRow()]);
    __seedSheet(LOG, [[]]);
  });

  it('returns error for invalid OTP', () => {
    const future = new Date(Date.now() + 1000 * 60 * 60).toISOString();
    __seedSheet(OTP, [
      ['Email', 'Code', 'CreatedAt', 'ExpiresAt', 'Used', 'IP'],
      ['u@test.com', '999999', new Date().toISOString(), future, false, ''],
    ]);
    const res = JSON.parse(verifyEmailOtp(req({ email: 'u@test.com', otpCode: '000000', sessionID: 'S1' })));
    expect(res.ok).toBe(false);
    expect(res.errorCode).toBe('INVALID_OTP');
  });

  it('logs in successfully with valid OTP', () => {
    const future = new Date(Date.now() + 1000 * 60 * 60).toISOString();
    __seedSheet(OTP, [
      ['Email', 'Code', 'CreatedAt', 'ExpiresAt', 'Used', 'IP'],
      ['u@test.com', '123456', new Date().toISOString(), future, false, ''],
    ]);
    const res = JSON.parse(verifyEmailOtp(req({ email: 'u@test.com', otpCode: '123456', sessionID: 'S1' })));
    expect(res.ok).toBe(true);
    expect(res.payload.member.email).toBe('u@test.com');
    // OTP should be marked used
    const otpRows = __getSheet(OTP);
    expect(otpRows[1][4]).toBe(true);
  });
});

describe('handleGoogleLogin', () => {
  beforeEach(() => {
    __seedSheet(CFG, [['Key', 'Value', 'Desc']]);
    __seedSheet(MM, [blankRow()]);
    __seedSheet(LOG, [[]]);
    // Session mock returns admin@mmrunners.org by default (set in setup.ts)
  });

  it('creates a new member on first login (Google Workspace account)', () => {
    const res = JSON.parse(handleGoogleLogin(req({ email: '', sessionID: 'S1' })));
    expect(res.ok).toBe(true);
    expect(res.payload.member.email).toBe('admin@mmrunners.org');
    expect(res.payload.member.status).toBe('not active');
  });

  it('returns existing member on second login', () => {
    // Pre-seed existing member
    const row = blankRow();
    row[0] = 'A0001'; row[4] = 'admin@mmrunners.org'; row[1] = 'active';
    __seedSheet(MM, [blankRow(), row]);
    const res = JSON.parse(handleGoogleLogin(req({ email: '', sessionID: 'S1' })));
    expect(res.ok).toBe(true);
    expect(res.payload.member.memberID).toBe('A0001');
    expect(res.payload.member.status).toBe('active');
  });
});
