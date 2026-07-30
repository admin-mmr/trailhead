/**
 * sendTracked — the claim/send/settle contract.
 *
 * The ordering is the whole safety property, so it is asserted directly: the
 * notification_log row must be claimed BEFORE the mail goes out, and a failed
 * send must RELEASE the claim so the next weekly run retries instead of the
 * member silently losing their only notice.
 */

jest.mock('@/lib/email/client', () => ({
  sendEmail: jest.fn(),
  ADMIN_CC: 'admin@mmrunners.org',
}))
jest.mock('@/lib/db/notifications', () => ({
  claimNotification: jest.fn(),
  markSent: jest.fn(),
  markFailed: jest.fn(),
  logNotification: jest.fn(),
}))

import { sendTracked } from '@/lib/notifications/send-tracked'
import { sendEmail } from '@/lib/email/client'
import {
  claimNotification,
  markSent,
  markFailed,
  logNotification,
} from '@/lib/db/notifications'

const mockSendEmail = sendEmail as jest.Mock
const mockClaim = claimNotification as jest.Mock
const mockMarkSent = markSent as jest.Mock
const mockMarkFailed = markFailed as jest.Mock
const mockLog = logNotification as jest.Mock

const base = {
  to: 'wei@example.com',
  subject: 'Renew your membership',
  html: '<p>hi</p>',
  emailType: 'renewal_reminder' as const,
  memberId: 'A0123',
}

beforeEach(() => {
  jest.clearAllMocks()
  mockClaim.mockResolvedValue({ id: 42 })
  mockSendEmail.mockResolvedValue(undefined)
})

describe('deduped sends', () => {
  it('claims before sending — never the other way round', async () => {
    const order: string[] = []
    mockClaim.mockImplementation(async () => { order.push('claim'); return { id: 42 } })
    mockSendEmail.mockImplementation(async () => { order.push('send') })

    const outcome = await sendTracked({ ...base, dedupeKey: 'renewal:A0123:2027-03-31:T30' })

    expect(outcome).toEqual({ status: 'sent' })
    expect(order).toEqual(['claim', 'send'])
    expect(mockMarkSent).toHaveBeenCalledWith(42)
  })

  it('sends nothing when the claim is already taken', async () => {
    mockClaim.mockResolvedValue(null)

    const outcome = await sendTracked({ ...base, dedupeKey: 'renewal:A0123:2027-03-31:T30' })

    expect(outcome).toEqual({ status: 'skipped', reason: 'already_sent' })
    expect(mockSendEmail).not.toHaveBeenCalled()
    expect(mockMarkSent).not.toHaveBeenCalled()
  })

  it('releases the claim when the send fails, so the next run retries', async () => {
    mockSendEmail.mockRejectedValue(new Error('GAS webhook 504'))

    const outcome = await sendTracked({ ...base, dedupeKey: 'k' })

    expect(outcome).toEqual({ status: 'failed', error: 'GAS webhook 504' })
    expect(mockMarkFailed).toHaveBeenCalledWith(42, expect.any(Error))
    expect(mockMarkSent).not.toHaveBeenCalled()
  })

  it('never throws out to the caller — batch jobs must survive one bad send', async () => {
    mockSendEmail.mockRejectedValue(new Error('nope'))
    await expect(sendTracked({ ...base, dedupeKey: 'k' })).resolves.toMatchObject({
      status: 'failed',
    })
  })
})

describe('transactional sends (no dedupe key)', () => {
  it('sends every time and logs the result', async () => {
    const outcome = await sendTracked(base)

    expect(outcome).toEqual({ status: 'sent' })
    expect(mockClaim).not.toHaveBeenCalled()   // receipts must not be deduped
    expect(mockSendEmail).toHaveBeenCalledTimes(1)
    expect(mockLog).toHaveBeenCalledWith(expect.objectContaining({ status: 'sent' }))
  })

  it('logs a failure without throwing', async () => {
    mockSendEmail.mockRejectedValue(new Error('smtp down'))

    const outcome = await sendTracked(base)

    expect(outcome).toEqual({ status: 'failed', error: 'smtp down' })
    expect(mockLog).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'failed', error: 'smtp down' }),
    )
  })
})

describe('recipient handling', () => {
  it.each([undefined, null, '', '   '])('skips a missing address (%p) and logs why', async (to) => {
    const outcome = await sendTracked({ ...base, to: to as string | null | undefined })

    expect(outcome).toEqual({ status: 'skipped', reason: 'no_recipient' })
    expect(mockSendEmail).not.toHaveBeenCalled()
    expect(mockClaim).not.toHaveBeenCalled()
    expect(mockLog).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'skipped', recipient: '(none)' }),
    )
  })

  it('CCs the club by default, and honours ccAdmin: false', async () => {
    await sendTracked(base)
    expect(mockSendEmail).toHaveBeenCalledWith(
      expect.objectContaining({ cc: 'admin@mmrunners.org' }),
    )

    mockSendEmail.mockClear()
    await sendTracked({ ...base, ccAdmin: false })
    expect(mockSendEmail).toHaveBeenCalledWith(expect.objectContaining({ cc: undefined }))
  })

  it('trims the address before sending', async () => {
    await sendTracked({ ...base, to: '  wei@example.com ' })
    expect(mockSendEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'wei@example.com' }),
    )
  })
})
