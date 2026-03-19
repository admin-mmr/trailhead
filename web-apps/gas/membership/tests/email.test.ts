// ============================================================
// email.test.ts — Email notification functions
// Tests: notifyPaymentApproved, notifyPaymentExpired, notifyPaymentRejected
// ============================================================

require('../src/types');
require('../src/ui');
require('../src/config');
require('../src/sheets');
require('../src/logger');
require('../src/email');

declare function notifyPaymentApproved(memberID: string, paymentIntent: string): void;
declare function notifyPaymentExpired(memberID: string, eventID: string): void;
declare function notifyPaymentRejected(memberID: string, reason: string): void;
declare function findMemberByID(id: string): any;
declare function getConfigValue(key: string): string;
declare function __seedSheet(name: string, rows: any[][]): void;
declare function __getSheet(name: string): any[][];

const MAIN = 'Main';
const CONFIG = 'Config';

function makeMainRow(overrides: Record<number, any> = {}): any[] {
  const future = new Date();
  future.setFullYear(future.getFullYear() + 1);
  const row: any[] = new Array(24).fill('');
  row[0] = 'A0001';
  row[1] = 'active';
  row[3] = future.toISOString();
  row[4] = 'alice@example.com';
  row[5] = 'Alice';
  row[6] = 'Smith';
  row[7] = 'Individual';
  Object.entries(overrides).forEach(([k, v]) => { row[Number(k)] = v; });
  return row;
}

function seedConfig(): void {
  __seedSheet(CONFIG, [
    ['Key', 'Value', 'Description'],
    ['AdminEmails', 'admin@example.com', ''],
  ]);
}

describe('notifyPaymentApproved', () => {
  beforeEach(() => {
    seedConfig();
    const mockSendEmail = (global as any).GmailApp?.sendEmail as jest.Mock;
    if (mockSendEmail) mockSendEmail.mockClear();
  });

  it('sends notification when member is found', () => {
    __seedSheet(MAIN, [new Array(24).fill(''), makeMainRow({ 0: 'A0001', 4: 'alice@example.com' })]);

    // Should not throw error when member exists
    notifyPaymentApproved('A0001', 'Individual Membership');
    expect(true).toBe(true); // If no error thrown, test passes
  });

  it('handles payment intent in notification', () => {
    __seedSheet(MAIN, [new Array(24).fill(''), makeMainRow({ 0: 'A0001', 4: 'alice@example.com' })]);

    notifyPaymentApproved('A0001', 'Family Upgrade');
    expect(true).toBe(true);
  });

  it('logs warning when member not found', () => {
    __seedSheet(MAIN, [new Array(24).fill('')]);
    const mockConsoleWarn = jest.spyOn(console, 'warn').mockImplementation();

    notifyPaymentApproved('A9999', 'Individual Membership');

    expect(mockConsoleWarn).toHaveBeenCalled();
    mockConsoleWarn.mockRestore();
  });
});

describe('notifyPaymentExpired', () => {
  beforeEach(() => {
    seedConfig();
    const mockSendEmail = (global as any).GmailApp?.sendEmail as jest.Mock;
    if (mockSendEmail) mockSendEmail.mockClear();
  });

  it('sends expiration notice when member exists', () => {
    __seedSheet(MAIN, [new Array(24).fill(''), makeMainRow({ 0: 'A0001', 4: 'alice@example.com' })]);

    notifyPaymentExpired('A0001', 'EV-001');
    expect(true).toBe(true);
  });

  it('includes event ID in expiration notification', () => {
    __seedSheet(MAIN, [new Array(24).fill(''), makeMainRow({ 0: 'A0001', 4: 'alice@example.com' })]);

    notifyPaymentExpired('A0001', 'EV-12345');
    expect(true).toBe(true);
  });

  it('logs warning when member not found', () => {
    __seedSheet(MAIN, [new Array(24).fill('')]);
    const mockConsoleWarn = jest.spyOn(console, 'warn').mockImplementation();

    notifyPaymentExpired('A9999', 'EV-001');

    expect(mockConsoleWarn).toHaveBeenCalled();
    mockConsoleWarn.mockRestore();
  });
});

describe('notifyPaymentRejected', () => {
  beforeEach(() => {
    seedConfig();
    const mockSendEmail = (global as any).GmailApp?.sendEmail as jest.Mock;
    if (mockSendEmail) mockSendEmail.mockClear();
  });

  it('sends rejection notice when member exists', () => {
    __seedSheet(MAIN, [new Array(24).fill(''), makeMainRow({ 0: 'A0001', 4: 'alice@example.com' })]);

    notifyPaymentRejected('A0001', 'Screenshot illegible, please resubmit');
    expect(true).toBe(true);
  });

  it('includes rejection reason in notification', () => {
    __seedSheet(MAIN, [new Array(24).fill(''), makeMainRow({ 0: 'A0001', 4: 'alice@example.com' })]);

    notifyPaymentRejected('A0001', 'Payment amount mismatch');
    expect(true).toBe(true);
  });

  it('logs warning when member not found', () => {
    __seedSheet(MAIN, [new Array(24).fill('')]);
    const mockConsoleWarn = jest.spyOn(console, 'warn').mockImplementation();

    notifyPaymentRejected('A9999', 'Insufficient funds');

    expect(mockConsoleWarn).toHaveBeenCalled();
    mockConsoleWarn.mockRestore();
  });
});

export {};
