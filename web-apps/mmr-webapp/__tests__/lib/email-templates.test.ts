/**
 * Tests for lib/email/templates.ts
 *
 * These are pure-function tests — no network, no DB, no Next.js runtime needed.
 * Run with: npm test
 */

import {
  welcomeEmailHtml,
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
  expect(html).toContain('info@mistymountainrunners.org')
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
    // "March 22, 2027" or locale variant
    expect(html).toMatch(/March\s+22,\s+2027/)
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
