/**
 * Tests for lib/access.ts
 *
 * Verifies the route access tier logic without hitting the DB or middleware.
 * Run with: npm test
 */

import { getRequiredTier, type AccessTier } from '@/lib/access'

// Helper: assert tier for a given path
function expectTier(path: string, expected: AccessTier) {
  expect(getRequiredTier(path)).toBe(expected)
}

describe('getRequiredTier — public routes', () => {
  it.each([
    '/',
    '/login',
    '/join',
    '/join/something',
    '/donate',
    '/auth/complete',
    '/auth/forgot-password',
    '/auth/reset-password',
    '/api/auth/callback/google',
    '/api/auth/callback/microsoft-entra-id',
    '/api/donations/submit',
    '/api/payments/submit',
    '/api/payments/stripe/checkout',
    '/api/payments/stripe/webhook',
    '/payment/success',
    '/membership/inactive',
    '/blog/post-1',
    '/events',
    '/hall-of-fame',
  ])('"%s" is public', (path) => {
    expectTier(path, 'public')
  })
})

describe('getRequiredTier — member routes (any login required)', () => {
  it.each([
    '/api/members/me',
    '/api/members/search',
    '/api/payments',
    '/api/payments/proof',
    '/portal/profile',
  ])('"%s" requires member access', (path) => {
    expectTier(path, 'member')
  })
})

describe('getRequiredTier — active-member-only routes', () => {
  it.each([
    '/portal',
    '/portal/nyrr',
    '/portal/events',
    '/api/photos',
    '/api/bibs',
    '/api/admin',
    '/api/events',
    '/api/events/calendar',
  ])('"%s" requires an active membership', (path) => {
    expectTier(path, 'active')
  })

  it('does not confuse the public "/events" rule with "/api/events"', () => {
    // Prefix matching is literal: '/api/events' does not start with '/events',
    // so without its own rule the member calendar API would fall through to the
    // public default and hand out RSVP data to anyone.
    expectTier('/events', 'public')
    expectTier('/api/events/calendar', 'active')
  })
})

describe('getRequiredTier — admin routes', () => {
  it('"/admin" requires admin access', () => {
    expectTier('/admin', 'admin')
  })
})

describe('getRequiredTier — unmatched paths default to public', () => {
  it('returns public for an unknown path', () => {
    expectTier('/some/random/path', 'public')
  })

  it('returns public for root path', () => {
    expectTier('/', 'public')
  })
})
