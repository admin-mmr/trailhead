/**
 * Contract tests for POST /api/payments/stripe/webhook (P1k item 7)
 *
 * Mocks the mysql2 pool, the Stripe client, and lib/db/config.
 * Verifies: signature rejection, duplicate-event idempotency (stripe_events
 * PK), amount-mismatch rejection, and the ledger pattern — gmail_transactions
 * row + sp_link_transaction for member payments, direct payments insert for
 * anonymous donations — all inside one transaction.
 */

// ── Mock next/server ─────────────────────────────────────────────────────────
jest.mock('next/server', () => ({
  NextRequest: class {},
  NextResponse: {
    json: jest.fn((body: unknown, init?: { status?: number }) => ({
      status: init?.status ?? 200,
      body,
    })),
  },
}))

jest.mock('@/lib/db/connection', () => ({
  pool: { getConnection: jest.fn() },
  getDb: jest.fn(),
}))
jest.mock('@/lib/stripe', () => ({ getStripe: jest.fn() }))
jest.mock('@/lib/payments/fulfillment-email', () => ({ sendFulfillmentEmail: jest.fn() }))
jest.mock('@/lib/db/config', () => ({
  getMembershipPrice: jest.fn(),
  MEMBERSHIP_PRICING: {
    'Individual Membership': { configKey: 'IndividualPrice', fallback: 30 },
    'Family Membership':     { configKey: 'FamilyPrice', fallback: 50 },
    'Family Upgrade':        { configKey: 'FamilyUpgradePrice', fallback: 20 },
  },
}))

import { POST } from '@/app/api/payments/stripe/webhook/route'
import { pool } from '@/lib/db/connection'
import { getStripe } from '@/lib/stripe'
import { getMembershipPrice } from '@/lib/db/config'
import { sendFulfillmentEmail } from '@/lib/payments/fulfillment-email'

const post = POST as unknown as (req: unknown) => Promise<{ status: number; body: any }>
const mockGetConnection = pool.getConnection as jest.Mock
const mockGetStripe = getStripe as jest.Mock
const mockGetMembershipPrice = getMembershipPrice as jest.Mock
const mockSendFulfillmentEmail = sendFulfillmentEmail as jest.Mock

function makeReq(headers: Record<string, string> = { 'stripe-signature': 'sig_ok' }) {
  return {
    headers: { get: (k: string) => headers[k.toLowerCase()] ?? null },
    text: async () => '{"raw":"payload"}',
  } as any
}

function makeEvent(overrides: Record<string, any> = {}, sessionOverrides: Record<string, any> = {}) {
  return {
    id: 'evt_test_001',
    type: 'checkout.session.completed',
    livemode: true,
    data: {
      object: {
        id: 'cs_test_001',
        payment_intent: 'pi_test_001',
        payment_status: 'paid',
        amount_total: 3000,
        customer_details: { name: 'Jo Runner', email: 'jo@example.com' },
        metadata: {
          submissionID: 'SUB-20260719-AAA11',
          memberID: 'MMR-2026-0042',
          plan: 'membership_payment',
          paymentType: 'Individual Membership',
        },
        ...sessionOverrides,
      },
    },
    ...overrides,
  }
}

let conn: {
  execute: jest.Mock
  query: jest.Mock
  beginTransaction: jest.Mock
  commit: jest.Mock
  rollback: jest.Mock
  release: jest.Mock
}
let constructEvent: jest.Mock

beforeEach(() => {
  jest.clearAllMocks()
  process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test'
  delete process.env.STRIPE_ALLOW_TEST_FULFILLMENT
  conn = {
    execute: jest.fn().mockResolvedValue([{}]),
    query: jest.fn().mockResolvedValue([{}]),
    beginTransaction: jest.fn(),
    commit: jest.fn(),
    rollback: jest.fn(),
    release: jest.fn(),
  }
  mockGetConnection.mockResolvedValue(conn)
  constructEvent = jest.fn().mockReturnValue(makeEvent())
  mockGetStripe.mockReturnValue({ webhooks: { constructEvent } })
  mockGetMembershipPrice.mockResolvedValue(30)
})

// ── Signature rejection ───────────────────────────────────────────────────────

describe('POST /api/payments/stripe/webhook — signature', () => {
  it('rejects a bad signature with 400 and never touches the DB', async () => {
    constructEvent.mockImplementation(() => { throw new Error('bad sig') })
    const res = await post(makeReq())
    expect(res.status).toBe(400)
    expect(res.body.error).toBe('Invalid signature')
    expect(mockGetConnection).not.toHaveBeenCalled()
  })

  it('rejects a missing stripe-signature header with 400', async () => {
    const res = await post(makeReq({}))
    expect(res.status).toBe(400)
    expect(constructEvent).not.toHaveBeenCalled()
  })

  it('500 when STRIPE_WEBHOOK_SECRET is unset', async () => {
    delete process.env.STRIPE_WEBHOOK_SECRET
    const res = await post(makeReq())
    expect(res.status).toBe(500)
  })
})

// ── Ledger pattern happy path ─────────────────────────────────────────────────

describe('POST /api/payments/stripe/webhook — ledger pattern', () => {
  it('member payment: stripe_events guard → gmail_transactions row → sp_link_transaction, committed', async () => {
    const res = await post(makeReq())
    expect(res.status).toBe(200)
    expect(conn.beginTransaction).toHaveBeenCalled()

    const executed = conn.execute.mock.calls.map(c => c[0] as string)
    expect(executed[0]).toMatch(/INSERT INTO stripe_events/)
    expect(conn.execute.mock.calls[0][1]).toEqual(['evt_test_001', 'pi_test_001', expect.any(String), 1])
    expect(executed[1]).toMatch(/INSERT INTO gmail_transactions/)
    const gmailParams = conn.execute.mock.calls[1][1]
    expect(gmailParams[0]).toBe('pi_test_001')       // TransactionNumber = PaymentIntent id
    expect(gmailParams[1]).toBe('Jo Runner')         // Sender
    expect(gmailParams[2]).toBe(30)                  // Amount
    expect(gmailParams[4]).toBe('Stripe')            // PaymentMethod — live, no TEST marker
    expect(gmailParams[5]).toBe('evt_test_001')      // MessageId = event id

    expect(conn.query).toHaveBeenCalledWith(
      'CALL sp_link_transaction(?, ?, ?, ?, ?)',
      ['pi_test_001', 'MMR-2026-0042', 'Individual Membership', 30, 'SUB-20260719-AAA11']
    )
    expect(conn.commit).toHaveBeenCalled()
    expect(conn.release).toHaveBeenCalled()
  })

  it('anonymous donation: direct payments insert with NULL MemberID, no proc call', async () => {
    constructEvent.mockReturnValue(makeEvent({}, {
      amount_total: 10050,
      metadata: { submissionID: 'SUB-20260719-BBB22', memberID: '', plan: 'donation', paymentType: 'Donation' },
    }))
    // Donation amount check reads the submissions row (separate connection)
    conn.execute.mockImplementation(async (sql: string) =>
      /FROM submissions/.test(sql) ? [[{ Amount: '100.50' }]] : [{}]
    )
    const res = await post(makeReq())
    expect(res.status).toBe(200)
    expect(conn.query).not.toHaveBeenCalled()
    const paymentsCall = conn.execute.mock.calls.find(c => /INSERT INTO payments/.test(c[0]))
    expect(paymentsCall).toBeDefined()
    expect(paymentsCall![1]).toEqual(['pi_test_001', 'Donation', 100.5, 'SUB-20260719-BBB22'])
    expect(conn.commit).toHaveBeenCalled()
  })

  it('test-mode event WITHOUT the pilot flag → acknowledged but never touches the ledger', async () => {
    constructEvent.mockReturnValue(makeEvent({ livemode: false }))
    const res = await post(makeReq())
    expect(res.status).toBe(200)
    expect(res.body.ignored).toBe('test_mode')
    expect(conn.beginTransaction).not.toHaveBeenCalled()
    expect(conn.query).not.toHaveBeenCalled()
    // audit row records the ignored event with livemode=0
    const audit = conn.execute.mock.calls.find(c => /INSERT INTO stripe_events/.test(c[0]))
    expect(audit![1]).toContain('ignored_test_mode')
    expect(audit![1][4]).toBe(0)
  })

  it('test-mode event WITH pilot flag → fulfilled, marked Stripe (TEST) with TEST memo', async () => {
    process.env.STRIPE_ALLOW_TEST_FULFILLMENT = '1'
    constructEvent.mockReturnValue(makeEvent({ livemode: false }))
    const res = await post(makeReq())
    expect(res.status).toBe(200)
    const gmailParams = conn.execute.mock.calls[1][1]
    expect(gmailParams[3]).toMatch(/^TEST — /)       // Memo prefixed
    expect(gmailParams[4]).toBe('Stripe (TEST)')     // PaymentMethod marked
    expect(conn.execute.mock.calls[0][1][3]).toBe(0) // stripe_events.livemode = 0
    expect(conn.commit).toHaveBeenCalled()
  })

  it('ignores other event types and unpaid sessions', async () => {
    constructEvent.mockReturnValue(makeEvent({ type: 'payment_intent.created' }))
    expect((await post(makeReq())).body).toEqual({ received: true })

    constructEvent.mockReturnValue(makeEvent({}, { payment_status: 'unpaid' }))
    expect((await post(makeReq())).body).toEqual({ received: true })
    expect(mockGetConnection).not.toHaveBeenCalled()
  })
})

// ── Idempotency ───────────────────────────────────────────────────────────────

describe('POST /api/payments/stripe/webhook — idempotency', () => {
  it('duplicate event delivery → rollback + 200 duplicate, payment not re-created', async () => {
    conn.execute.mockRejectedValue(Object.assign(new Error('dup'), { code: 'ER_DUP_ENTRY' }))
    const res = await post(makeReq())
    expect(res.status).toBe(200)
    expect(res.body.duplicate).toBe(true)
    expect(conn.rollback).toHaveBeenCalled()
    expect(conn.query).not.toHaveBeenCalled() // sp_link_transaction never reached
  })

  it('mid-transaction DB failure → rollback + 500 so Stripe retries clean', async () => {
    conn.execute
      .mockResolvedValueOnce([{}]) // stripe_events insert ok
      .mockRejectedValueOnce(new Error('connect ETIMEDOUT')) // gmail_transactions fails
    const res = await post(makeReq())
    expect(res.status).toBe(500)
    expect(conn.rollback).toHaveBeenCalled()
    expect(conn.commit).not.toHaveBeenCalled()
    expect(conn.release).toHaveBeenCalled()
  })
})

// ── Amount verification ───────────────────────────────────────────────────────

describe('POST /api/payments/stripe/webhook — amount verification', () => {
  it('membership amount mismatch vs config → acknowledged but rejected, no payment written', async () => {
    constructEvent.mockReturnValue(makeEvent({}, { amount_total: 9900 })) // $99, config says $30
    const res = await post(makeReq())
    expect(res.status).toBe(200)
    expect(res.body.rejected).toBe('amount_mismatch')
    expect(conn.beginTransaction).not.toHaveBeenCalled()
    // audit row recorded with mismatch status
    const auditCall = conn.execute.mock.calls.find(c => /INSERT INTO stripe_events/.test(c[0]))
    expect(auditCall![0]).toMatch(/ON DUPLICATE KEY UPDATE/)
    expect(auditCall![1]).toContain('amount_mismatch')
  })

  it('donation amount mismatch vs submission row → rejected', async () => {
    constructEvent.mockReturnValue(makeEvent({}, {
      amount_total: 500, // $5, submission says $100.50
      metadata: { submissionID: 'SUB-20260719-BBB22', memberID: '', plan: 'donation', paymentType: 'Donation' },
    }))
    conn.execute.mockImplementation(async (sql: string) =>
      /FROM submissions/.test(sql) ? [[{ Amount: '100.50' }]] : [{}]
    )
    const res = await post(makeReq())
    expect(res.body.rejected).toBe('amount_mismatch')
    expect(conn.beginTransaction).not.toHaveBeenCalled()
  })

  it('fails open when the config lookup errors (payment still processed)', async () => {
    mockGetMembershipPrice.mockRejectedValue(new Error('config table gone'))
    const res = await post(makeReq())
    expect(res.status).toBe(200)
    expect(conn.commit).toHaveBeenCalled()
  })
})

// ── Confirmation email ────────────────────────────────────────────────────────

describe('POST /api/payments/stripe/webhook — confirmation email', () => {
  it('sends the fulfillment email after the commit, with the ledger reference', async () => {
    const res = await post(makeReq())

    expect(res.status).toBe(200)
    expect(mockSendFulfillmentEmail).toHaveBeenCalledTimes(1)
    expect(mockSendFulfillmentEmail).toHaveBeenCalledWith({
      memberId:      'MMR-2026-0042',
      paymentType:   'Individual Membership',
      amount:        30,
      referenceId:   'pi_test_001',
      paymentMethod: 'Stripe',
      payerEmail:    'jo@example.com',
      payerName:     'Jo Runner',
      livemode:      true,
    })
    // ordering: the email must not go out before the DB commit
    expect(conn.commit.mock.invocationCallOrder[0])
      .toBeLessThan(mockSendFulfillmentEmail.mock.invocationCallOrder[0])
  })

  it('labels test-mode payments so the email can say so', async () => {
    process.env.STRIPE_ALLOW_TEST_FULFILLMENT = '1'
    constructEvent.mockReturnValue(makeEvent({ livemode: false }))

    await post(makeReq())

    expect(mockSendFulfillmentEmail.mock.calls[0][0]).toMatchObject({
      livemode: false,
      paymentMethod: 'Stripe (TEST)',
    })
  })

  it('sends nothing when a test event is ignored', async () => {
    constructEvent.mockReturnValue(makeEvent({ livemode: false }))
    const res = await post(makeReq())
    expect(res.body.ignored).toBe('test_mode')
    expect(mockSendFulfillmentEmail).not.toHaveBeenCalled()
  })

  it('sends nothing on an amount mismatch', async () => {
    constructEvent.mockReturnValue(makeEvent({}, { amount_total: 9900 }))
    await post(makeReq())
    expect(mockSendFulfillmentEmail).not.toHaveBeenCalled()
  })

  it('sends nothing on a duplicate delivery — the first delivery already emailed', async () => {
    conn.execute.mockRejectedValue(Object.assign(new Error('dup'), { code: 'ER_DUP_ENTRY' }))
    const res = await post(makeReq())
    expect(res.body.duplicate).toBe(true)
    expect(mockSendFulfillmentEmail).not.toHaveBeenCalled()
  })

  it('sends nothing when the transaction rolls back', async () => {
    conn.execute
      .mockResolvedValueOnce([{}])
      .mockRejectedValueOnce(new Error('connect ETIMEDOUT'))
    const res = await post(makeReq())
    expect(res.status).toBe(500)
    expect(mockSendFulfillmentEmail).not.toHaveBeenCalled()
  })
})
