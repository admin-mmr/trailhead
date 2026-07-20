/**
 * Contract tests for POST /api/payments/stripe/checkout (P1k item 7)
 *
 * Mocks the mysql2 pool, the Stripe client, and lib/db/config.
 * Verifies: server-side amount derivation (config price for memberships,
 * submissions.Amount for donations — never the client), metadata contract
 * consumed by the webhook, and rejection paths (unknown / non-pending
 * submission, invalid input).
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
jest.mock('@/lib/db/config', () => ({
  getMembershipPrice: jest.fn(),
  MEMBERSHIP_PRICING: {
    'Individual Membership': { configKey: 'IndividualPrice', fallback: 30 },
    'Family Membership':     { configKey: 'FamilyPrice', fallback: 50 },
    'Family Upgrade':        { configKey: 'FamilyUpgradePrice', fallback: 20 },
  },
}))

import { POST } from '@/app/api/payments/stripe/checkout/route'
import { pool } from '@/lib/db/connection'
import { getStripe } from '@/lib/stripe'
import { getMembershipPrice } from '@/lib/db/config'

const post = POST as unknown as (req: unknown) => Promise<{ status: number; body: any }>
const mockGetConnection = pool.getConnection as jest.Mock
const mockGetStripe = getStripe as jest.Mock
const mockGetMembershipPrice = getMembershipPrice as jest.Mock

function makeReq(body: unknown) {
  return { json: async () => body, url: 'https://app.test/api/payments/stripe/checkout' } as any
}

const membershipSub = {
  SubmissionID: 'SUB-20260719-AAA11',
  MemberID: 'MMR-2026-0042',
  Amount: '999.00', // deliberately wrong — config must win
  PaymentIntent: 'Individual Membership',
  SubmissionType: 'membership_payment',
  Status: 'pending',
}

const donationSub = {
  SubmissionID: 'SUB-20260719-BBB22',
  MemberID: null,
  Amount: '100.50',
  PaymentIntent: 'Donation',
  SubmissionType: 'donation',
  Status: 'pending',
}

let conn: { execute: jest.Mock; release: jest.Mock }
let sessionsCreate: jest.Mock

beforeEach(() => {
  jest.clearAllMocks()
  conn = { execute: jest.fn().mockResolvedValue([[membershipSub]]), release: jest.fn() }
  mockGetConnection.mockResolvedValue(conn)
  sessionsCreate = jest.fn().mockResolvedValue({ url: 'https://checkout.stripe.com/c/pay/cs_test_123' })
  mockGetStripe.mockReturnValue({ checkout: { sessions: { create: sessionsCreate } } })
  mockGetMembershipPrice.mockResolvedValue(30)
})

// ── Amount derivation ─────────────────────────────────────────────────────────

describe('POST /api/payments/stripe/checkout — amount derivation', () => {
  it('membership: charges the config price, not the submission amount', async () => {
    const res = await post(makeReq({ submissionId: membershipSub.SubmissionID }))
    expect(res.status).toBe(200)
    expect(res.body.url).toMatch(/^https:\/\/checkout\.stripe\.com\//)
    expect(mockGetMembershipPrice).toHaveBeenCalledWith('Individual Membership')
    const args = sessionsCreate.mock.calls[0][0]
    expect(args.line_items[0].price_data.unit_amount).toBe(3000) // $30 from config, not $999
  })

  it('donation: charges the submissions row amount', async () => {
    conn.execute.mockResolvedValue([[donationSub]])
    await post(makeReq({ submissionId: donationSub.SubmissionID }))
    expect(mockGetMembershipPrice).not.toHaveBeenCalled()
    const args = sessionsCreate.mock.calls[0][0]
    expect(args.line_items[0].price_data.unit_amount).toBe(10050) // $100.50
  })

  it('falls back to the submission amount if the config lookup returns null', async () => {
    mockGetMembershipPrice.mockResolvedValue(null)
    await post(makeReq({ submissionId: membershipSub.SubmissionID }))
    const args = sessionsCreate.mock.calls[0][0]
    expect(args.line_items[0].price_data.unit_amount).toBe(99900)
  })
})

// ── Metadata contract (consumed by the webhook — cross-boundary vocabulary) ──

describe('POST /api/payments/stripe/checkout — metadata contract', () => {
  it('threads submissionID, memberID, and paymentType through session metadata', async () => {
    await post(makeReq({ submissionId: membershipSub.SubmissionID, email: 'jo@example.com' }))
    const args = sessionsCreate.mock.calls[0][0]
    expect(args.metadata.submissionID).toBe('SUB-20260719-AAA11')
    expect(args.metadata.memberID).toBe('MMR-2026-0042')
    expect(args.metadata.paymentType).toBe('Individual Membership')
    expect(args.customer_email).toBe('jo@example.com')
    expect(args.client_reference_id).toBe('SUB-20260719-AAA11')
    expect(args.success_url).toContain('/payment/success?session_id=')
    expect(args.cancel_url).toContain('/join?canceled=1')
  })

  it('donation cancel returns to /donate', async () => {
    conn.execute.mockResolvedValue([[donationSub]])
    await post(makeReq({ submissionId: donationSub.SubmissionID }))
    expect(sessionsCreate.mock.calls[0][0].cancel_url).toContain('/donate?canceled=1')
  })
})

// ── Rejections ────────────────────────────────────────────────────────────────

describe('POST /api/payments/stripe/checkout — rejections', () => {
  it('404 for unknown submission', async () => {
    conn.execute.mockResolvedValue([[]])
    const res = await post(makeReq({ submissionId: 'SUB-NOPE' }))
    expect(res.status).toBe(404)
    expect(sessionsCreate).not.toHaveBeenCalled()
  })

  it('409 for a non-pending submission', async () => {
    conn.execute.mockResolvedValue([[{ ...membershipSub, Status: 'approved' }]])
    const res = await post(makeReq({ submissionId: membershipSub.SubmissionID }))
    expect(res.status).toBe(409)
    expect(sessionsCreate).not.toHaveBeenCalled()
  })

  it.each([
    ['missing submissionId', {}],
    ['empty submissionId', { submissionId: '' }],
    ['bad email', { submissionId: 'SUB-X', email: 'nope' }],
  ])('rejects %s with 400 and does not touch the DB', async (_label, body) => {
    const res = await post(makeReq(body))
    expect(res.status).toBe(400)
    expect(mockGetConnection).not.toHaveBeenCalled()
  })

  it('500 with connection released when Stripe errors', async () => {
    sessionsCreate.mockRejectedValue(new Error('stripe down'))
    const res = await post(makeReq({ submissionId: membershipSub.SubmissionID }))
    expect(res.status).toBe(500)
    expect(conn.release).toHaveBeenCalled()
  })
})
