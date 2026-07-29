/**
 * Tests for lib/email/templates.ts
 *
 * These are pure-function tests — no network, no DB, no Next.js runtime needed.
 * Run with: npm test
 */

import {
  welcomeEmailHtml,
  paymentConfirmationEmailHtml,
  applicationReceivedEmailHtml,
  renewalReminderEmailHtml,
  membershipActivatedEmailHtml,
  passwordResetEmailHtml,
} from '@/lib/email/templates'

// ── Shared assertions ────────────────────────────────────────────────────────

function expectBilingualLayout(html: string) {
  expect(html).toContain('Misty Mountain Runners')
  expect(html).toContain('岚山跑团')
  expect(html).toContain('Open Member Portal')
  expect(html).toContain('admin@mmrunners.org')
}

// ── welcomeEmailHtml ─────────────────────────────────────────────────────────

describe('welcomeEmailHtml', () => {
  const params = {
    firstName: 'Cathy',
    memberId: 'MMR-2026-0042',
    expiresAt: '2027-03-22T00:00:00.000Z',
    planLabel: 'Individual',
  }

  it('includes the member first name in the greeting', () => {
    const html = welcomeEmailHtml(params)
    expect(html).toContain('Welcome, Cathy!')
  })

  it('includes the member ID', () => {
    const html = welcomeEmailHtml(params)
    expect(html).toContain('MMR-2026-0042')
  })

  it('includes the plan label', () => {
    const html = welcomeEmailHtml(params)
    expect(html).toContain('Individual')
  })

  it('formats the expiry date in a human-readable form', () => {
    const html = welcomeEmailHtml(params)
    // Date rendering depends on timezone — accept March 21 or 22, 2027
    expect(html).toMatch(/March\s+2[12],\s+2027/)
  })

  it('renders the bilingual layout wrapper', () => {
    expectBilingualLayout(welcomeEmailHtml(params))
  })

  it('includes the Chinese welcome line', () => {
    const html = welcomeEmailHtml(params)
    expect(html).toContain('欢迎加入岚山跑团')
    expect(html).toContain('MMR-2026-0042')
  })
})

// ── applicationReceivedEmailHtml ─────────────────────────────────────────────

describe('applicationReceivedEmailHtml', () => {
  const params = {
    firstName: 'Wei',
    planLabel: 'Family',
    amount: 50,
    paymentMethod: 'zelle',
    referenceId: 'ZEL-9999',
  }

  it('includes the first name', () => {
    const html = applicationReceivedEmailHtml(params)
    expect(html).toContain('Wei')
  })

  it('includes the plan and amount', () => {
    const html = applicationReceivedEmailHtml(params)
    expect(html).toContain('Family')
    expect(html).toContain('50')
  })

  it('includes the reference ID', () => {
    const html = applicationReceivedEmailHtml(params)
    expect(html).toContain('ZEL-9999')
  })

  it('includes a link to the payment proof upload page', () => {
    const html = applicationReceivedEmailHtml(params)
    expect(html).toContain('/payment-proof')
  })

  it('renders the bilingual layout wrapper', () => {
    expectBilingualLayout(applicationReceivedEmailHtml(params))
  })
})

// ── renewalReminderEmailHtml ──────────────────────────────────────────────────

describe('renewalReminderEmailHtml', () => {
  const base = {
    firstName: 'Lin',
    memberId: 'MMR-2025-0007',
    expiresAt: '2026-04-01T00:00:00.000Z',
    daysLeft: 10,
  }

  it('shows the members name', () => {
    const html = renewalReminderEmailHtml(base)
    expect(html).toContain('Lin')
  })

  it('shows the member ID', () => {
    const html = renewalReminderEmailHtml(base)
    expect(html).toContain('MMR-2025-0007')
  })

  it('shows the days left count', () => {
    const html = renewalReminderEmailHtml(base)
    expect(html).toContain('10 days')
  })

  it('uses singular "day" when daysLeft is 1', () => {
    const html = renewalReminderEmailHtml({ ...base, daysLeft: 1 })
    expect(html).toContain('1 day')
    expect(html).not.toContain('1 days')
  })

  it('adds "Action needed:" prefix for 30-day warning', () => {
    const html = renewalReminderEmailHtml({ ...base, daysLeft: 30 })
    expect(html).toContain('Action needed:')
  })

  it('adds "Urgent:" prefix when 7 or fewer days remain', () => {
    const html = renewalReminderEmailHtml({ ...base, daysLeft: 7 })
    expect(html).toContain('Urgent:')
  })

  it('has no urgency prefix for more than 30 days', () => {
    const html = renewalReminderEmailHtml({ ...base, daysLeft: 60 })
    expect(html).not.toContain('Urgent:')
    expect(html).not.toContain('Action needed:')
  })

  it('includes the renewal CTA link', () => {
    const html = renewalReminderEmailHtml(base)
    expect(html).toContain('/join')
  })
})

// ── welcomeEmailHtml: Stripe fulfillment extras ──────────────────────────────

describe('welcomeEmailHtml — receipt, set-password CTA, test banner', () => {
  const base = {
    firstName: 'Cathy',
    memberId: 'A0667',
    expiresAt: '2027-03-31T00:00:00.000Z',
    planLabel: 'Individual Membership',
  }
  const payment = {
    amount: 30,
    paymentMethod: 'Stripe (TEST)',
    referenceId: 'pi_3TvAbCdEf',
    paidOn: '2026-07-29',
  }

  it('renders the payment receipt when a payment is supplied', () => {
    const html = welcomeEmailHtml({ ...base, payment })
    expect(html).toContain('$30.00')
    expect(html).toContain('Stripe (TEST)')
    expect(html).toContain('pi_3TvAbCdEf')
    expect(html).toContain('July 29, 2026')
    expect(html).toContain('Individual Membership — payment received')
  })

  it('omits the receipt entirely when no payment is supplied', () => {
    const html = welcomeEmailHtml(base)
    expect(html).not.toContain('Paid for')
    expect(html).not.toContain('Reference #')
  })

  it('renders the set-password CTA pointing at the given URL', () => {
    const url = 'https://mmrunners.org/auth/forgot-password?email=jo%40example.com'
    const html = welcomeEmailHtml({ ...base, setPasswordUrl: url })
    expect(html).toContain('Set My Password')
    expect(html).toContain(`href="${url}"`)
    expect(html).toContain('请点击下方按钮设置密码后登录')
  })

  it('omits the CTA for members who can already sign in', () => {
    expect(welcomeEmailHtml(base)).not.toContain('Set My Password')
  })

  it('shows the test-mode banner only in test mode', () => {
    expect(welcomeEmailHtml({ ...base, testMode: true })).toContain('Test payment')
    expect(welcomeEmailHtml({ ...base, testMode: true })).toContain('未产生真实扣款')
    expect(welcomeEmailHtml(base)).not.toContain('Test payment')
  })

  it('keeps the shared bilingual layout', () => {
    expectBilingualLayout(welcomeEmailHtml({ ...base, payment, setPasswordUrl: 'https://x/y', testMode: true }))
  })
})

// ── paymentConfirmationEmailHtml ─────────────────────────────────────────────

describe('paymentConfirmationEmailHtml', () => {
  const base = {
    firstName: 'Cathy',
    amount: 30,
    paymentMethod: 'Stripe',
    referenceId: 'pi_3TvAbCdEf',
    description: 'Individual Membership',
    paidOn: '2026-07-29',
  }

  it('reads as a receipt for a membership renewal, including the new expiration', () => {
    const html = paymentConfirmationEmailHtml({ ...base, expiresAt: '2027-03-31' })
    expect(html).toContain('Payment received, Cathy!')
    expect(html).toContain('$30.00')
    expect(html).toContain('March 31, 2027')
    expect(html).toContain('Membership valid until')
    expectBilingualLayout(html)
  })

  it('switches to donation wording and drops the expiration row', () => {
    const html = paymentConfirmationEmailHtml({ ...base, description: 'Donation', amount: 10 })
    expect(html).toContain('Thank you, Cathy!')
    expect(html).toContain('$10.00')
    expect(html).toContain('感谢您对岚山跑团的捐赠')
    expect(html).not.toContain('Membership valid until')
  })

  it('passes a non-date paidOn through unchanged rather than rendering Invalid Date', () => {
    const html = paymentConfirmationEmailHtml({ ...base, paidOn: 'today' })
    expect(html).toContain('today')
    expect(html).not.toContain('Invalid Date')
  })

  it('shows the test banner in test mode', () => {
    expect(paymentConfirmationEmailHtml({ ...base, testMode: true })).toContain('Test payment')
    expect(paymentConfirmationEmailHtml(base)).not.toContain('Test payment')
  })
})

// ── membershipActivatedEmailHtml ─────────────────────────────────────────────

describe('membershipActivatedEmailHtml', () => {
  it('delegates to welcomeEmailHtml (same output)', () => {
    const params = {
      firstName: 'Sam',
      memberId: 'MMR-2026-0100',
      expiresAt: '2027-01-01T00:00:00.000Z',
      planLabel: 'Individual',
    }
    expect(membershipActivatedEmailHtml(params)).toBe(welcomeEmailHtml(params))
  })
})

// ── passwordResetEmailHtml ────────────────────────────────────────────────────

describe('passwordResetEmailHtml', () => {
  const params = {
    firstName: 'Alex',
    resetUrl: 'https://mmrunners.org/auth/reset-password?token=abc123',
    expiryMins: 30,
  }

  it('includes the first name', () => {
    const html = passwordResetEmailHtml(params)
    expect(html).toContain('Alex')
  })

  it('includes the reset URL as both a link and plain text', () => {
    const html = passwordResetEmailHtml(params)
    // Should appear at least twice: as href and as visible URL
    const occurrences = (html.match(/abc123/g) ?? []).length
    expect(occurrences).toBeGreaterThanOrEqual(2)
  })

  it('shows the expiry duration', () => {
    const html = passwordResetEmailHtml(params)
    expect(html).toContain('30 minutes')
  })

  it('includes the Chinese reset password line', () => {
    const html = passwordResetEmailHtml(params)
    expect(html).toContain('重置您的密码')
  })

  it('includes a safety message for users who did not request the reset', () => {
    const html = passwordResetEmailHtml(params)
    expect(html).toContain("didn't request")
  })
})
