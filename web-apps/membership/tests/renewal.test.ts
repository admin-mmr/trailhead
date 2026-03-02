// Tests for renewal.ts — submit, reconcile, approve, reject

require('../src/types');
require('../src/config');
require('../src/sheets');
require('../src/logger');
require('../src/members');
require('../src/renewal');

declare function submitRenewalRequest(jsonRequest: string): string;
declare function approveRenewal(jsonRequest: string): string;
declare function rejectRenewal(jsonRequest: string): string;
declare function reconcileWebAppWithGmail(): string;
declare function __seedSheet(name: string, rows: any[][]): void;
declare function __getSheet(name: string): any[][];

const MM = 'Membership-Master-Main-3';
const WE = 'WebApp-Events';
const PH = 'Payment-History';
const LOG = 'WebApp-ActivityLog';
const CFG = 'Config';
const FG = 'Fetch-Gmail-data-in-Google-Spreadsheet-Active-4';

function blankRow(len = 23) { return new Array(len).fill(''); }
function req(payload: any): string {
  return JSON.stringify({ requestId: 'test-req', payload });
}
function weHeader() {
  return ['EventID','EventType','Timestamp','MemberID','Email','MembershipType','Amount','PaymentMethod','PayerName','MemoField','Last4Digits','FamilyEmails','Status','MatchedMsgID','MatchedTxNum','AdminApprover','ApprovalDate','Notes'];
}

describe('submitRenewalRequest', () => {
  beforeEach(() => {
    __seedSheet(WE, [weHeader()]);
    __seedSheet(LOG, [[]]);
  });

  it('appends a Pending event to WebApp-Events', () => {
    const res = JSON.parse(submitRenewalRequest(req({
      memberId: 'A0001', email: 'user@test.com',
      membershipType: 'Individual', amount: 30,
      paymentMethod: 'Zelle', payerName: 'Test User',
      memoField: 'A0001 2026 membership', sessionID: 'S1',
    })));
    expect(res.ok).toBe(true);
    expect(res.payload.eventID).toMatch(/^EV-/);
    const rows = __getSheet(WE);
    expect(rows).toHaveLength(2);
    expect(rows[1][12]).toBe('Pending');
  });
});

describe('approveRenewal', () => {
  beforeEach(() => {
    __seedSheet(LOG, [[]]);
    __seedSheet(PH, [['PaymentID']]);
    __seedSheet(CFG, [['Key', 'Value', 'Desc'], ['Membership_Renewal_Years', '1', '']]);
  });

  it('returns NOT_FOUND for unknown event', () => {
    __seedSheet(WE, [weHeader()]);
    const res = JSON.parse(approveRenewal(req({ eventID: 'EV-FAKE', adminEmail: 'admin@test.com' })));
    expect(res.ok).toBe(false);
    expect(res.errorCode).toBe('NOT_FOUND');
  });

  it('activates member and writes Payment-History', () => {
    // Seed member
    const memberRow = blankRow();
    memberRow[0] = 'A0001'; memberRow[4] = 'user@test.com'; memberRow[1] = 'not active';
    __seedSheet(MM, [blankRow(), memberRow]);

    // Seed event
    const eventRow = weHeader().map(() => '');
    eventRow[0] = 'EV-001'; eventRow[1] = 'MembershipRenewal'; eventRow[2] = new Date().toISOString();
    eventRow[3] = 'A0001'; eventRow[4] = 'user@test.com';
    eventRow[5] = 'Individual'; eventRow[6] = 30; eventRow[7] = 'Zelle';
    eventRow[8] = 'Test User'; eventRow[9] = 'A0001 2026'; eventRow[12] = 'Matched';
    __seedSheet(WE, [weHeader(), eventRow]);

    const res = JSON.parse(approveRenewal(req({ eventID: 'EV-001', adminEmail: 'admin@test.com', notes: '' })));
    expect(res.ok).toBe(true);
    expect(res.payload.periodEnd).toBeTruthy();

    // Member should be active
    const mmRows = __getSheet(MM);
    expect(mmRows[1][1]).toBe('active');

    // Payment-History should have a new row
    const phRows = __getSheet(PH);
    expect(phRows).toHaveLength(2);

    // Event status should be Approved
    const weRows = __getSheet(WE);
    expect(weRows[1][12]).toBe('Approved');
  });

  it('extends expiration from current if still active', () => {
    const futureExp = '2027-06-15'; // currently active member
    const memberRow = blankRow();
    memberRow[0] = 'A0001'; memberRow[4] = 'u@t.com'; memberRow[1] = 'active';
    memberRow[3] = futureExp;
    __seedSheet(MM, [blankRow(), memberRow]);

    const eventRow = weHeader().map(() => '');
    eventRow[0] = 'EV-002'; eventRow[1] = 'MembershipRenewal'; eventRow[2] = new Date().toISOString();
    eventRow[3] = 'A0001'; eventRow[4] = 'u@t.com';
    eventRow[5] = 'Individual'; eventRow[6] = 30; eventRow[7] = 'Zelle';
    eventRow[8] = 'User'; eventRow[9] = 'A0001'; eventRow[12] = 'Matched';
    __seedSheet(WE, [weHeader(), eventRow]);

    const res = JSON.parse(approveRenewal(req({ eventID: 'EV-002', adminEmail: 'admin@t.com' })));
    expect(res.ok).toBe(true);
    // New expiry should be at least 2028-06-15 (1 year past current 2027-06-15)
    const periodEnd = new Date(res.payload.periodEnd);
    expect(periodEnd.getFullYear()).toBeGreaterThanOrEqual(2028);
  });

  it('updates all family members for Family renewal', () => {
    const r1 = blankRow(); r1[0] = 'A0001'; r1[4] = 'p@t.com'; r1[1] = 'not active'; r1[8] = 'B001';
    const r2 = blankRow(); r2[0] = 'A0002'; r2[4] = 'c@t.com'; r2[1] = 'not active'; r2[8] = 'B001';
    __seedSheet(MM, [blankRow(), r1, r2]);

    const eventRow = weHeader().map(() => '');
    eventRow[0] = 'EV-003'; eventRow[1] = 'MembershipRenewal'; eventRow[2] = new Date().toISOString();
    eventRow[3] = 'A0001'; eventRow[4] = 'p@t.com';
    eventRow[5] = 'Family'; eventRow[6] = 50; eventRow[7] = 'Venmo';
    eventRow[8] = 'Parent'; eventRow[9] = 'B001 family 2026'; eventRow[12] = 'Matched';
    __seedSheet(WE, [weHeader(), eventRow]);

    const res = JSON.parse(approveRenewal(req({ eventID: 'EV-003', adminEmail: 'admin@t.com' })));
    expect(res.ok).toBe(true);
    const mmRows = __getSheet(MM);
    // Both family members should be active
    expect(mmRows[1][1]).toBe('active');
    expect(mmRows[2][1]).toBe('active');
  });
});

describe('rejectRenewal', () => {
  beforeEach(() => {
    __seedSheet(LOG, [[]]);
  });

  it('sets status to Rejected', () => {
    const eventRow = weHeader().map(() => '');
    eventRow[0] = 'EV-REJ'; eventRow[12] = 'Pending';
    __seedSheet(WE, [weHeader(), eventRow]);

    const res = JSON.parse(rejectRenewal(req({ eventID: 'EV-REJ', adminEmail: 'admin@t.com', notes: 'Payment not found' })));
    expect(res.ok).toBe(true);
    const weRows = __getSheet(WE);
    expect(weRows[1][12]).toBe('Rejected');
  });
});

describe('reconcileWebAppWithGmail', () => {
  beforeEach(() => {
    __seedSheet(LOG, [[]]);
    __seedSheet(CFG, [['Key', 'Value', 'Desc']]);
  });

  it('matches event to Gmail payment by last 4 digits', () => {
    const eventRow = weHeader().map(() => '');
    eventRow[0] = 'EV-REC'; eventRow[2] = new Date().toISOString();
    eventRow[3] = 'A0001'; eventRow[5] = 'Individual'; eventRow[6] = 30;
    eventRow[7] = 'Zelle'; eventRow[8] = 'Alice'; eventRow[10] = '5678'; eventRow[12] = 'Pending';
    __seedSheet(WE, [weHeader(), eventRow]);

    const fgHeader = ['TS','Sender','Amount','Memo','TxDate','TxNum','MsgId','Subj','OrigMemo','Notes','Processed','Source','WebAppEventID'];
    const fgRow = ['2026-01-01','Alice',30,'A0001 2026','2026-01-01','TX005678','MSG1','Zelle','','',false,'Zelle',''];
    __seedSheet(FG, [fgHeader, fgRow]);

    const res = JSON.parse(reconcileWebAppWithGmail());
    expect(res.ok).toBe(true);
    expect(res.payload.matchCount).toBe(1);

    // Event status should be Matched
    const weRows = __getSheet(WE);
    expect(weRows[1][12]).toBe('Matched');

    // Gmail row should be marked processed
    const fgRows = __getSheet(FG);
    expect(fgRows[1][10]).toBe(true);
  });
});
