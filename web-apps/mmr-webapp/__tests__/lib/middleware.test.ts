/**
 * Tests for middleware.ts
 *
 * Verifies JWT-based access control without a real server or DB.
 * Mocks:
 *   - 'jose' (jwtVerify) — controls JWT payload / throws
 *   - 'next/server' (NextRequest, NextResponse) — lightweight stubs
 *
 * Covers:
 *   - Public routes pass through with x-pathname header set
 *   - Protected routes with missing cookie → redirect to /login?from=
 *   - Protected routes with invalid/expired JWT → redirect to /login
 *   - member-tier route with active status → pass through
 *   - member-tier route with inactive status → redirect to /login (member tier only requires any session)
 *   - active-tier route with inactive status → redirect to /membership/inactive
 *   - active-tier route with active status → pass through
 *   - admin-tier route with active status → pass through (admin DB check is in route handler)
 *   - admin-tier route with inactive status → redirect to /membership/inactive
 */

// ── Mock next/server ──────────────────────────────────────────────────────────

class MockURL {
  href: string
  pathname: string
  searchParams: URLSearchParams
  constructor(url: string, base?: string) {
    // Very minimal implementation sufficient for middleware tests
    let full = url
    if (base && !url.startsWith('http')) {
      const b = new URL(base) // real Node URL
      full = b.origin + url
    }
    // Use real URL to parse
    try {
      const parsed = new URL(full)
      this.href = parsed.href
      this.pathname = parsed.pathname
      this.searchParams = parsed.searchParams
    } catch {
      this.href = full
      this.pathname = url
      this.searchParams = new URLSearchParams()
    }
  }
}

// Track what was called
let lastNextResponse: { type: 'next' | 'redirect'; url?: string; headers?: Headers } | null = null

const mockNextResponse = {
  next: jest.fn((opts?: { request?: { headers?: Headers } }) => {
    lastNextResponse = { type: 'next', headers: opts?.request?.headers }
    return { type: 'next', headers: opts?.request?.headers }
  }),
  redirect: jest.fn((url: { href: string }) => {
    lastNextResponse = { type: 'redirect', url: url.href }
    return { type: 'redirect', url: url.href }
  }),
}

jest.mock('next/server', () => ({
  NextRequest: class {
    nextUrl: any
    cookies: any
    headers: Headers
    url: string
    constructor(url: string, init?: any) {
      this.url = url
      this.nextUrl = new MockURL(url)
      this.headers = new Headers(init?.headers ?? {})
      this.cookies = {
        get: (name: string) => init?.cookies?.[name]
          ? { value: init.cookies[name] }
          : undefined,
      }
    }
  },
  NextResponse: mockNextResponse,
}))

// ── Mock jose ────────────────────────────────────────────────────────────────

let mockPayload: Record<string, unknown> | null = null
let mockVerifyThrows = false

jest.mock('jose', () => ({
  jwtVerify: jest.fn(async () => {
    if (mockVerifyThrows) throw new Error('jwt expired')
    if (!mockPayload) throw new Error('no payload configured')
    return { payload: mockPayload }
  }),
}))

// ── Import middleware after mocks ────────────────────────────────────────────
// Must be require(), not import: an ES import is hoisted above the const
// mockNextResponse definition, so the jest.mock factory would hit its TDZ.

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { middleware } = require('@/middleware') as typeof import('@/middleware')

// ── Helpers ──────────────────────────────────────────────────────────────────

const BASE = 'http://localhost:3000'

function makeReq(pathname: string, sessionToken?: string) {
  const { NextRequest } = require('next/server')
  return new NextRequest(`${BASE}${pathname}`, {
    headers: {},
    cookies: sessionToken ? { mmr_session: sessionToken } : {},
  })
}

function redirectUrl() {
  return lastNextResponse?.type === 'redirect' ? lastNextResponse.url : null
}

function passedThrough() {
  return lastNextResponse?.type === 'next'
}

function xPathname() {
  if (lastNextResponse?.type !== 'next') return null
  return lastNextResponse.headers?.get('x-pathname') ?? null
}

beforeEach(() => {
  jest.clearAllMocks()
  lastNextResponse = null
  mockPayload = null
  mockVerifyThrows = false
  process.env.JWT_SECRET = 'test-secret-32-chars-minimum-len!'
})

// ── Public routes ─────────────────────────────────────────────────────────────

describe('public routes', () => {
  it.each([
    '/',
    '/login',
    '/join',
    '/join/step2',
    '/donate',
    '/events',
    '/blog/post-slug',
    '/hall-of-fame',
    '/api/auth/callback/google',
    '/api/donations/submit',
    '/membership/inactive',
    '/auth/forgot-password',
    '/auth/reset-password',
  ])('passes through "%s" without checking JWT', async (pathname) => {
    await middleware(makeReq(pathname))  // no cookie provided
    expect(passedThrough()).toBe(true)
  })

  it('sets x-pathname header for public routes', async () => {
    await middleware(makeReq('/events'))
    expect(xPathname()).toBe('/events')
  })
})

// ── Missing session cookie ────────────────────────────────────────────────────

describe('missing session cookie', () => {
  it.each([
    '/portal',
    '/portal/profile',
    '/api/members/me',
    '/admin',
  ])('redirects "%s" to /login when no cookie', async (pathname) => {
    await middleware(makeReq(pathname))
    const url = redirectUrl()
    expect(url).toContain('/login')
    expect(url).toContain(encodeURIComponent(pathname))
  })
})

// ── Invalid / expired JWT ─────────────────────────────────────────────────────

describe('invalid JWT', () => {
  it('redirects to /login on JWT verification failure', async () => {
    mockVerifyThrows = true
    await middleware(makeReq('/portal', 'bad-token'))
    expect(redirectUrl()).toContain('/login')
  })
})

// ── member tier ───────────────────────────────────────────────────────────────

describe('member tier — any valid session passes', () => {
  it.each(['active', 'inactive', 'pending', 'expired'] as const)(
    'allows "%s" member through /api/members/me',
    async (status) => {
      mockPayload = { memberId: 'A0001', status }
      await middleware(makeReq('/api/members/me', 'valid-token'))
      expect(passedThrough()).toBe(true)
    }
  )

  it('allows any-status member through /payment-proof', async () => {
    mockPayload = { memberId: 'A0001', status: 'pending' }
    await middleware(makeReq('/payment-proof', 'valid-token'))
    expect(passedThrough()).toBe(true)
  })
})

// ── active tier ───────────────────────────────────────────────────────────────

describe('active tier', () => {
  it('allows active member through /portal', async () => {
    mockPayload = { memberId: 'A0001', status: 'active' }
    await middleware(makeReq('/portal', 'valid-token'))
    expect(passedThrough()).toBe(true)
  })

  it('allows active member through /api/photos', async () => {
    mockPayload = { memberId: 'A0001', status: 'active' }
    await middleware(makeReq('/api/photos', 'valid-token'))
    expect(passedThrough()).toBe(true)
  })

  it.each(['inactive', 'pending', 'expired'] as const)(
    'redirects "%s" member from /portal to /membership/inactive',
    async (status) => {
      mockPayload = { memberId: 'A0001', status }
      await middleware(makeReq('/portal', 'valid-token'))
      const url = redirectUrl()
      expect(url).toContain('/membership/inactive')
      expect(url).toContain('status=' + status)
    }
  )

  it('includes `from` param in inactive redirect', async () => {
    mockPayload = { memberId: 'A0001', status: 'inactive' }
    await middleware(makeReq('/portal/nyrr', 'valid-token'))
    const url = redirectUrl()!
    expect(url).toContain('from=')
    expect(url).toContain(encodeURIComponent('/portal/nyrr'))
  })
})

// ── admin tier ────────────────────────────────────────────────────────────────

describe('admin tier', () => {
  it('passes active member through /admin (DB check deferred to route handler)', async () => {
    mockPayload = { memberId: 'A0001', status: 'active' }
    await middleware(makeReq('/admin', 'valid-token'))
    expect(passedThrough()).toBe(true)
  })

  it('redirects inactive member from /admin to /membership/inactive', async () => {
    mockPayload = { memberId: 'A0001', status: 'inactive' }
    await middleware(makeReq('/admin', 'valid-token'))
    expect(redirectUrl()).toContain('/membership/inactive')
  })

  it('redirects missing cookie from /admin to /login', async () => {
    await middleware(makeReq('/admin'))
    expect(redirectUrl()).toContain('/login')
  })
})

// ── x-pathname header ─────────────────────────────────────────────────────────

describe('x-pathname header on pass-through', () => {
  it('sets x-pathname for authenticated protected route', async () => {
    mockPayload = { memberId: 'A0001', status: 'active' }
    await middleware(makeReq('/portal/profile', 'valid-token'))
    expect(xPathname()).toBe('/portal/profile')
  })
})
