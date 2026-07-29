/**
 * Tests for lib/email/client sendEmail — specifically that CC is opt-in.
 *
 * The regression this guards: cc used to default to ADMIN_CC for every email,
 * so password-reset mail put a live, unexpired reset-token link in the club's
 * shared admin inbox (and admin-list notifications arrived twice).
 */

jest.mock('@/lib/email/templates', () => ({
  welcomeEmailHtml:               jest.fn(() => '<html>welcome</html>'),
  applicationReceivedEmailHtml:   jest.fn(() => '<html>received</html>'),
  paymentConfirmationEmailHtml:   jest.fn(() => '<html>receipt</html>'),
  renewalReminderEmailHtml:       jest.fn(() => '<html>renewal</html>'),
  paymentRejectedEmailHtml:       jest.fn(() => '<html>rejected</html>'),
  paymentExpiredEmailHtml:        jest.fn(() => '<html>expired</html>'),
  expirationRepairedEmailHtml:    jest.fn(() => '<html>repaired</html>'),
  autoMatchConfirmationEmailHtml: jest.fn(() => '<html>matched</html>'),
  passwordResetEmailHtml:         jest.fn(() => '<html>reset</html>'),
}))

import {
  ADMIN_CC,
  sendEmail,
  sendMemberWelcomeEmail,
  sendPaymentConfirmationEmail,
} from '@/lib/email/client'

// jsdom has no AbortSignal.timeout, which sendEmail passes to fetch.
if (typeof AbortSignal.timeout !== 'function') {
  ;(AbortSignal as unknown as { timeout: (ms: number) => AbortSignal }).timeout = () =>
    new AbortController().signal
}

const mockFetch = jest.fn()

/** The JSON body of the nth webhook POST. */
function payloadOf(call = 0) {
  return JSON.parse(mockFetch.mock.calls[call][1].body)
}

beforeEach(() => {
  jest.clearAllMocks()
  process.env.GAS_WEBHOOK_URL = 'https://script.example/exec'
  mockFetch.mockResolvedValue({ ok: true, status: 200, statusText: 'OK' })
  global.fetch = mockFetch as unknown as typeof fetch
})

describe('sendEmail — CC handling', () => {
  it('omits cc entirely when the caller does not ask for one', async () => {
    await sendEmail({
      to:        'runner@example.com',
      subject:   'Reset your MMR password',
      html:      '<a href="https://mmr/auth/reset-password?token=secret">reset</a>',
      emailType: 'password_reset',
    })

    const payload = payloadOf()
    expect(payload.cc).toBeUndefined()
    // Absent, not empty-string: the GAS handler sets options.cc only when truthy,
    // but an explicit key would still land in the Email Log's CCEmail column.
    expect(Object.prototype.hasOwnProperty.call(payload, 'cc')).toBe(false)
    expect(payload.to).toBe('runner@example.com')
  })

  it('never leaks a reset link to the admin address', async () => {
    await sendEmail({
      to:        'runner@example.com',
      subject:   'Reset your MMR password',
      html:      '<a href="https://mmr/auth/reset-password?token=secret">reset</a>',
      emailType: 'password_reset',
    })

    expect(mockFetch.mock.calls[0][1].body).not.toContain(ADMIN_CC)
  })

  it('passes a single cc through unchanged', async () => {
    await sendEmail({
      to:      'runner@example.com',
      subject: 'Hello',
      html:    '<p>hi</p>',
      cc:      ADMIN_CC,
    })

    expect(payloadOf().cc).toBe(ADMIN_CC)
  })

  it('joins an array of cc addresses with commas', async () => {
    await sendEmail({
      to:      'runner@example.com',
      subject: 'Hello',
      html:    '<p>hi</p>',
      cc:      [ADMIN_CC, 'treasurer@mmrunners.org'],
    })

    expect(payloadOf().cc).toBe(`${ADMIN_CC},treasurer@mmrunners.org`)
  })
})

describe('sendEmail — membership mail still copies the club', () => {
  it('CCs ADMIN_CC on the welcome email', async () => {
    await sendMemberWelcomeEmail({
      to:        'runner@example.com',
      firstName: 'Ada',
      memberId:  'A0667',
      expiresAt: '2027-03-31',
    })

    expect(payloadOf().cc).toBe(ADMIN_CC)
    expect(payloadOf().email_type).toBe('welcome')
  })

  it('CCs ADMIN_CC on the payment receipt', async () => {
    await sendPaymentConfirmationEmail({
      to:            'runner@example.com',
      firstName:     'Ada',
      amount:        30,
      paymentMethod: 'Stripe',
      referenceId:   'pi_123',
      description:   'Individual Membership',
      paidOn:        '2026-07-29',
    })

    expect(payloadOf().cc).toBe(ADMIN_CC)
  })
})

describe('sendEmail — transport errors', () => {
  it('throws when the GAS webhook URL is not configured', async () => {
    delete process.env.GAS_WEBHOOK_URL
    await expect(
      sendEmail({ to: 'a@b.com', subject: 's', html: '<p>h</p>' })
    ).rejects.toThrow('GAS_WEBHOOK_URL not set')
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('throws when the webhook responds non-ok', async () => {
    mockFetch.mockResolvedValue({
      ok:         false,
      status:     500,
      statusText: 'Internal Server Error',
      text:       jest.fn().mockResolvedValue('boom'),
    })

    await expect(
      sendEmail({ to: 'a@b.com', subject: 's', html: '<p>h</p>' })
    ).rejects.toThrow('GAS webhook failed: 500')
  })
})
