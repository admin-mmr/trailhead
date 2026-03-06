// Tests for sheets.ts — row mapping and sheet helpers

require('../src/types');
require('../src/config');
require('../src/sheets');

declare function findMemberByEmail(email: string): { member: any; rowIndex: number } | null;
declare function findMemberByID(id: string): { member: any; rowIndex: number } | null;
declare function findMembersByFamilyID(familyID: string): Array<{ member: any; rowIndex: number }>;
declare function generateMemberID(): string;
declare function appendPaymentRecord(record: any): string;
declare function appendOtpRecord(record: any): void;
declare function findValidOtp(email: string, code: string): { rowIndex: number } | null;
declare function markOtpUsed(rowIndex: number): void;
declare function getUnmatchedGmailPayments(): any[];
declare function __seedSheet(name: string, rows: any[][]): void;
declare function __getSheet(name: string): any[][];

const MM = 'Membership-Master-Main-3';
const OTP = 'Auth-OTP';
const PH = 'Payment-History';
const FG = 'Fetch-Gmail-data-in-Google-Spreadsheet-Active-4';

function blankRow(len = 23) { return new Array(len).fill(''); }

describe('findMemberByEmail', () => {
  it('returns null when sheet is empty', () => {
    __seedSheet(MM, [['MemberID', 'Status']]);
    expect(findMemberByEmail('test@gmail.com')).toBeNull();
  });

  it('finds member by email (case-insensitive)', () => {
    const row = blankRow();
    row[0] = 'A0001'; row[1] = 'active'; row[4] = 'Test@Gmail.Com';
    __seedSheet(MM, [blankRow(), row]);
    const result = findMemberByEmail('test@gmail.com');
    expect(result).not.toBeNull();
    expect(result!.member.memberID).toBe('A0001');
  });
});

describe('findMemberByID', () => {
  it('returns null for unknown ID', () => {
    __seedSheet(MM, [blankRow()]);
    expect(findMemberByID('A9999')).toBeNull();
  });

  it('finds by exact MemberID', () => {
    const row = blankRow();
    row[0] = 'A0042'; row[4] = 'foo@bar.com';
    __seedSheet(MM, [blankRow(), row]);
    const result = findMemberByID('A0042');
    expect(result!.member.email).toBe('foo@bar.com');
  });
});

describe('findMembersByFamilyID', () => {
  it('returns all members with same familyID', () => {
    const r1 = blankRow(); r1[0] = 'A0001'; r1[8] = 'B001';
    const r2 = blankRow(); r2[0] = 'A0002'; r2[8] = 'B001';
    const r3 = blankRow(); r3[0] = 'A0003'; r3[8] = 'B002';
    __seedSheet(MM, [blankRow(), r1, r2, r3]);
    const results = findMembersByFamilyID('B001');
    expect(results).toHaveLength(2);
    expect(results.map(r => r.member.memberID)).toContain('A0001');
    expect(results.map(r => r.member.memberID)).toContain('A0002');
  });
});

describe('generateMemberID', () => {
  it('returns A0001 for empty sheet', () => {
    __seedSheet(MM, [blankRow()]);
    expect(generateMemberID()).toBe('A0001');
  });

  it('increments past max existing ID', () => {
    const r1 = blankRow(); r1[0] = 'A0050';
    const r2 = blankRow(); r2[0] = 'A0023';
    __seedSheet(MM, [blankRow(), r1, r2]);
    expect(generateMemberID()).toBe('A0051');
  });
});

describe('OTP helpers', () => {
  it('findValidOtp returns null for expired OTP', () => {
    const past = new Date(Date.now() - 1000 * 60 * 60).toISOString();
    __seedSheet(OTP, [
      ['Email', 'Code', 'CreatedAt', 'ExpiresAt', 'Used', 'IP'],
      ['u@test.com', '123456', past, past, false, ''],
    ]);
    expect(findValidOtp('u@test.com', '123456')).toBeNull();
  });

  it('findValidOtp returns rowIndex for valid OTP', () => {
    const future = new Date(Date.now() + 1000 * 60 * 60).toISOString();
    __seedSheet(OTP, [
      ['Email', 'Code', 'CreatedAt', 'ExpiresAt', 'Used', 'IP'],
      ['u@test.com', '654321', new Date().toISOString(), future, false, ''],
    ]);
    const result = findValidOtp('u@test.com', '654321');
    expect(result).not.toBeNull();
    expect(result!.rowIndex).toBe(2);
  });

  it('findValidOtp returns null for used OTP', () => {
    const future = new Date(Date.now() + 1000 * 60 * 60).toISOString();
    __seedSheet(OTP, [
      ['Email', 'Code', 'CreatedAt', 'ExpiresAt', 'Used', 'IP'],
      ['u@test.com', '111111', new Date().toISOString(), future, true, ''],
    ]);
    expect(findValidOtp('u@test.com', '111111')).toBeNull();
  });
});

describe('appendPaymentRecord', () => {
  it('appends a row and returns a payment ID', () => {
    __seedSheet(PH, [['PaymentID']]);
    const id = appendPaymentRecord({
      eventID: 'EV-1', memberID: 'A0001', paymentDate: '2026-01-01',
      amount: 30, membershipType: 'Individual', paymentMethod: 'Zelle',
      payerName: 'Test', memoField: 'A0001 2026', last4Digits: '1234',
      transactionReference: '', periodStart: '2026-01-01', periodEnd: '2026-12-31',
      processedBy: 'admin@test.com', processedDate: '2026-01-01', source: 'WebApp', notes: '',
    });
    expect(id).toMatch(/^PY-/);
    const rows = __getSheet(PH);
    expect(rows).toHaveLength(2); // header + appended row
  });
});

describe('getUnmatchedGmailPayments', () => {
  it('returns only unprocessed rows', () => {
    __seedSheet(FG, [
      ['TS', 'Sender', 'Amount', 'Memo', 'TxDate', 'TxNum', 'MsgId', 'Subj', 'OrigMemo', 'Notes', 'Processed', 'Source', 'WebAppEventID'],
      ['2026-01-01', 'Alice', 30, 'A0001 2026', '2026-01-01', 'TX001', 'MSG1', 'Zelle', '', '', false, 'Zelle', ''],
      ['2026-01-02', 'Bob', 50, 'B001 2026', '2026-01-02', 'TX002', 'MSG2', 'Venmo', '', '', true, 'Venmo', 'EV-1'],
    ]);
    const results = getUnmatchedGmailPayments();
    expect(results).toHaveLength(1);
    expect(results[0].sender).toBe('Alice');
  });
});
