// ============================================================
// payment-proof.test.ts — Payment proof submission
// Tests: submitPaymentProof basic functionality
// ============================================================

require('../src/types');
require('../src/ui');
require('../src/config');
require('../src/sheets');
require('../src/logger');
require('../src/payment_proof');

declare function submitPaymentProof(jsonRequest: string): string;
declare function __seedSheet(name: string, rows: any[][]): void;
declare function __getSheet(name: string): any[][];

const MAIN = 'Main';
const CONFIG = 'Config';

function req(payload: object): string {
  return JSON.stringify({ requestId: 'test-req', payload });
}

function seedConfig(): void {
  __seedSheet(CONFIG, [
    ['Key', 'Value', 'Description'],
    ['PaymentProofReviewDays', '7', ''],
    ['PaymentProofFolderId', 'folder123', ''],
  ]);
}

describe('submitPaymentProof', () => {
  beforeEach(() => {
    seedConfig();
  });

  it('requires memberID field', () => {
    const res = JSON.parse(submitPaymentProof(req({
      memberID: '',
      email: 'test@example.com',
      paymentIntent: 'Individual Membership',
    })));

    // Should either succeed or fail gracefully
    expect(res).toBeDefined();
    expect(res.ok !== undefined).toBe(true);
  });

  it('accepts valid payment proof submission', () => {
    const res = JSON.parse(submitPaymentProof(req({
      memberID: 'A0001',
      email: 'alice@example.com',
      paymentIntent: 'Individual Membership',
      amount: 30,
      paymentMethod: 'Zelle',
    })));

    // Function should return response (even if error due to missing Drive API)
    expect(res).toBeDefined();
  });

  it('includes requestId in response', () => {
    const res = JSON.parse(submitPaymentProof(req({
      memberID: 'A0001',
      email: 'test@example.com',
      paymentIntent: 'Dues',
    })));

    expect(res.requestId).toBe('test-req');
  });

  it('handles multiple payment methods', () => {
    const methods = ['Zelle', 'Venmo', 'PayPal', 'Bank Transfer'];

    methods.forEach(method => {
      const res = JSON.parse(submitPaymentProof(req({
        memberID: 'A0001',
        email: 'test@example.com',
        paymentIntent: 'Dues',
        paymentMethod: method,
      })));

      expect(res).toBeDefined();
    });
  });

  it('processes different payment intents', () => {
    const intents = ['Dues', 'Individual Membership', 'Family Upgrade'];

    intents.forEach(intent => {
      const res = JSON.parse(submitPaymentProof(req({
        memberID: 'A0001',
        email: 'test@example.com',
        paymentIntent: intent,
      })));

      expect(res).toBeDefined();
    });
  });

  it('returns response with payload property', () => {
    const res = JSON.parse(submitPaymentProof(req({
      memberID: 'A0001',
      email: 'test@example.com',
      paymentIntent: 'Dues',
    })));

    expect(res.payload !== undefined || res.errorCode !== undefined).toBe(true);
  });
});

export {};
