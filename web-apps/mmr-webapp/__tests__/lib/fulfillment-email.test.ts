/**
 * Tests for lib/payments/fulfillment-email.ts — which email a completed Stripe
 * payment earns, and the guarantee that a mail failure can never propagate into
 * the webhook (that would make Stripe retry a payment we already banked).
 */

jest.mock('@/lib/db/connection', () => ({
  pool: { getConnection: jest.fn() },
  getDb: jest.fn(),
}))
jest.mock('@/lib/email/client', () => ({
  sendMemberWelcomeEmail: jest.fn(),
  sendPaymentConfirmationEmail: jest.fn(),
}))

import { sendFulfillmentEmail } from '@/lib/payments/fulfillment-email'
import { pool } from '@/lib/db/connection'
import { sendMemberWelcomeEmail, sendPaymentConfirmationEmail } from '@/lib/email/client'

const mockGetConnection = pool.getConnection as jest.Mock
const mockWelcome = sendMemberWelcomeEmail as jest.Mock
const mockConfirm = sendPaymentConfirmationEmail as jest.Mock

const NEW_MEMBER = {
  Email: 'jo@example.com',
  FirstName: 'Jo',
  Status: 'active',
  Expiration: '2027-03-31',
  Type: 'Individual',
  password_hash: null,
  google_sub: null,
  microsoft_sub: null,
}

function withMember(row: Record<string, unknown> | null) {
  const conn = {
    execute: jest.fn().mockResolvedValue([row ? [row] : []]),
    release: jest.fn(),
  }
  mockGetConnection.mockResolvedValue(conn)
  return conn
}

const base = {
  memberId: 'A0667',
  paymentType: 'Individual Membership',
  amount: 30,
  referenceId: 'pi_test_001',
  paymentMethod: 'Stripe (TEST)',
  payerEmail: 'card@example.com',
  payerName: 'Jo Runner',
  livemode: false,
}

beforeEach(() => {
  jest.clearAllMocks()
  jest.spyOn(console, 'error').mockImplementation(() => {})
  jest.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  jest.restoreAllMocks()
})

describe('new member activated by this payment', () => {
  it('sends the welcome email with member ID, expiration, receipt and a set-password link', async () => {
    withMember(NEW_MEMBER)

    await sendFulfillmentEmail(base)

    expect(mockConfirm).not.toHaveBeenCalled()
    expect(mockWelcome).toHaveBeenCalledTimes(1)
    const arg = mockWelcome.mock.calls[0][0]
    expect(arg.to).toBe('jo@example.com')          // member row wins over the card email
    expect(arg.firstName).toBe('Jo')
    expect(arg.memberId).toBe('A0667')
    expect(arg.expiresAt).toBe('2027-03-31')
    expect(arg.planLabel).toBe('Individual Membership')
    expect(arg.payment).toEqual({
      amount: 30,
      paymentMethod: 'Stripe (TEST)',
      referenceId: 'pi_test_001',
      paidOn: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
    })
    expect(arg.testMode).toBe(true)
    expect(arg.setPasswordUrl).toContain('/auth/forgot-password?email=')
    expect(arg.setPasswordUrl).toContain(encodeURIComponent('jo@example.com'))
  })

  it('never puts a credential token in the link (the welcome email is CC\'d to admin)', async () => {
    withMember(NEW_MEMBER)

    await sendFulfillmentEmail(base)

    expect(mockWelcome.mock.calls[0][0].setPasswordUrl).not.toMatch(/token=/)
  })

  it('marks live payments as not test mode', async () => {
    withMember(NEW_MEMBER)

    await sendFulfillmentEmail({ ...base, livemode: true, paymentMethod: 'Stripe' })

    expect(mockWelcome.mock.calls[0][0].testMode).toBe(false)
  })

  it('accepts a Date from mysql2 for Expiration', async () => {
    withMember({ ...NEW_MEMBER, Expiration: new Date('2027-03-31T00:00:00Z') })

    await sendFulfillmentEmail(base)

    expect(mockWelcome.mock.calls[0][0].expiresAt).toBe('2027-03-31')
  })
})

describe('members who can already sign in → confirmation, not welcome', () => {
  it.each([
    ['a password',        { password_hash: 'argon2id$…' }],
    ['a Google account',  { google_sub: 'g-sub-123' }],
    ['a Microsoft account', { microsoft_sub: 'ms-sub-123' }],
  ])('sends the payment confirmation when the member has %s', async (_label, overrides) => {
    withMember({ ...NEW_MEMBER, ...overrides })

    await sendFulfillmentEmail(base)

    expect(mockWelcome).not.toHaveBeenCalled()
    expect(mockConfirm).toHaveBeenCalledTimes(1)
    const arg = mockConfirm.mock.calls[0][0]
    expect(arg.description).toBe('Individual Membership')
    expect(arg.expiresAt).toBe('2027-03-31')   // renewals show the new expiration
    expect(arg.memberId).toBe('A0667')
  })

  it('sends the confirmation when the member is not active (payment recorded, activation pending)', async () => {
    withMember({ ...NEW_MEMBER, Status: 'pending' })

    await sendFulfillmentEmail(base)

    expect(mockWelcome).not.toHaveBeenCalled()
    expect(mockConfirm).toHaveBeenCalledTimes(1)
  })
})

describe('donations', () => {
  it('sends a receipt to the anonymous payer with no member lookup and no expiration', async () => {
    await sendFulfillmentEmail({
      ...base,
      memberId: null,
      paymentType: 'Donation',
      amount: 10,
    })

    expect(mockGetConnection).not.toHaveBeenCalled()
    expect(mockWelcome).not.toHaveBeenCalled()
    const arg = mockConfirm.mock.calls[0][0]
    expect(arg.to).toBe('card@example.com')
    expect(arg.firstName).toBe('Jo')          // derived from the card name
    expect(arg.description).toBe('Donation')
    expect(arg.expiresAt).toBeUndefined()
    expect(arg.memberId).toBeUndefined()
  })

  it('sends a member donation receipt without the welcome path', async () => {
    withMember(NEW_MEMBER)

    await sendFulfillmentEmail({ ...base, paymentType: 'Donation', amount: 25 })

    expect(mockWelcome).not.toHaveBeenCalled()
    expect(mockConfirm.mock.calls[0][0].expiresAt).toBeUndefined()
  })
})

describe('failure containment', () => {
  it('resolves (never throws) when the mail send fails', async () => {
    withMember(NEW_MEMBER)
    mockWelcome.mockRejectedValue(new Error('GAS webhook 500'))

    await expect(sendFulfillmentEmail(base)).resolves.toBeUndefined()
  })

  it('resolves when the member lookup fails', async () => {
    mockGetConnection.mockRejectedValue(new Error('ECONNREFUSED'))

    await expect(sendFulfillmentEmail(base)).resolves.toBeUndefined()
    expect(mockWelcome).not.toHaveBeenCalled()
    expect(mockConfirm).not.toHaveBeenCalled()
  })

  it('skips silently when there is no address to send to', async () => {
    withMember({ ...NEW_MEMBER, Email: null })

    await sendFulfillmentEmail({ ...base, payerEmail: null })

    expect(mockWelcome).not.toHaveBeenCalled()
    expect(mockConfirm).not.toHaveBeenCalled()
  })

  it('falls back to the card email when the member row is missing', async () => {
    withMember(null)

    await sendFulfillmentEmail(base)

    expect(mockConfirm.mock.calls[0][0].to).toBe('card@example.com')
  })
})
