/**
 * Contract tests for /auth/complete — the NextAuth → mmr_session bridge.
 *
 * The rule this file exists to pin: **this route never creates a member.**
 * It used to mint a fresh 'pending' row for any unrecognised OAuth email and
 * send the person to /join, which forked existing members onto a second
 * MemberID whenever their Google address differed from the one on file. Most
 * members registered with a non-Google address (yahoo/hotmail/aol), so that
 * was the common path, not the edge case.
 *
 * Follows the repo's route-test convention: mock next/server rather than
 * polyfill Request/Response into jsdom.
 */

// ── Mock next/server ─────────────────────────────────────────────────────────
jest.mock('next/server', () => ({
  NextResponse: {
    redirect: jest.fn((url: URL) => ({ location: url.toString(), cookies: { set: jest.fn() } })),
  },
}))

// `auth(handler)` wraps the handler and injects req.auth — pass it through so
// the test supplies the session itself.
jest.mock('@/auth', () => ({
  auth: (handler: (req: unknown) => unknown) => handler,
}))

const cookieSet = jest.fn()
jest.mock('next/headers', () => ({
  cookies: () => Promise.resolve({ set: (...args: unknown[]) => cookieSet(...args) }),
}))

jest.mock('@/lib/db/members', () => ({
  findMemberByEmail:    jest.fn(),
  createNewMember:      jest.fn(),
  updateMemberOAuthSub: jest.fn(),
}))

jest.mock('@/lib/auth/session', () => ({
  createSession:    jest.fn(() => Promise.resolve('header.payload.signature')),
  setSessionCookie: jest.fn((token: string) => ({ name: 'mmr_session', value: token })),
}))

import { GET } from '@/app/auth/complete/route'
import { findMemberByEmail, createNewMember, updateMemberOAuthSub } from '@/lib/db/members'
import { createSession } from '@/lib/auth/session'

const mockFind   = findMemberByEmail    as jest.Mock
const mockCreate = createNewMember      as jest.Mock
const mockOAuth  = updateMemberOAuthSub as jest.Mock
const mockSess   = createSession        as jest.Mock

const activeMember = {
  memberId:  'A0201',
  email:     'member@example.com',
  firstName: 'Cathy',
  lastName:  'Lin',
  status:    'active',
  expiresAt: '2099-03-31',
}

const req = (email: string | null, provider = 'google', providerAccountId = 'sub-123') => ({
  auth: email === null ? null : { user: { email, name: 'Cathy Lin' }, provider, providerAccountId },
})

const call = GET as unknown as (req: unknown) => Promise<{ location: string }>

// Mirrors the route's own BASE_URL, resolved from env at module load exactly as
// it is there — so these tests never depend on which host that turns out to be.
const BASE_ORIGIN = new URL(
  process.env.NEXTAUTH_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000',
).origin

beforeEach(() => {
  jest.clearAllMocks()
  jest.spyOn(console, 'log').mockImplementation(() => {})
})

afterEach(() => jest.restoreAllMocks())

describe('/auth/complete — unknown social address', () => {
  beforeEach(() => mockFind.mockResolvedValue(null))

  it('does NOT create a member', async () => {
    const res = await call(req('stranger@gmail.com'))

    expect(mockCreate).not.toHaveBeenCalled()
    expect(res.location).toContain('/login?error=oauth_no_member')
  })

  it('issues no session and records no provider sub', async () => {
    await call(req('stranger@gmail.com'))

    expect(mockSess).not.toHaveBeenCalled()
    expect(cookieSet).not.toHaveBeenCalled()
    expect(mockOAuth).not.toHaveBeenCalled()
  })

  it('keeps the unmatched address out of the redirect URL', async () => {
    const res = await call(req('stranger@gmail.com'))

    // The address must not leak into browser history or edge logs.
    expect(res.location).not.toContain('stranger')
    expect(res.location).not.toContain('%40')
  })
})

describe('/auth/complete — member on file', () => {
  it('signs them in and sends them to the portal, never /join', async () => {
    mockFind.mockResolvedValue(activeMember)

    const res = await call(req('member@example.com'))

    // Host comes from NEXTAUTH_URL, captured at module load — assert the path.
    expect(new URL(res.location).pathname).toBe('/portal')
    expect(res.location).not.toContain('/join')
    expect(cookieSet).toHaveBeenCalledTimes(1)
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it('records the provider sub', async () => {
    mockFind.mockResolvedValue(activeMember)

    await call(req('member@example.com', 'google', 'google-sub-999'))

    expect(mockOAuth).toHaveBeenCalledWith('A0201', 'google', 'google-sub-999')
  })

  it('puts the member id and status in the session', async () => {
    mockFind.mockResolvedValue(activeMember)

    await call(req('member@example.com'))

    expect(mockSess).toHaveBeenCalledWith(expect.objectContaining({
      memberId: 'A0201', email: 'member@example.com', status: 'active',
    }))
  })

  it('downgrades an active member whose expiration has passed', async () => {
    mockFind.mockResolvedValue({ ...activeMember, expiresAt: '2020-03-31' })

    await call(req('member@example.com'))

    expect(mockSess).toHaveBeenCalledWith(expect.objectContaining({ status: 'expired' }))
  })

  it('still signs in a pending member — the portal decides what they may see', async () => {
    mockFind.mockResolvedValue({ ...activeMember, status: 'pending' })

    const res = await call(req('member@example.com'))

    expect(new URL(res.location).pathname).toBe('/portal')
    expect(mockSess).toHaveBeenCalledWith(expect.objectContaining({ status: 'pending' }))
  })
})

describe('/auth/complete — ?from= destination', () => {
  // `from` arrives in a URL anyone can craft and mail around, and the hop
  // happens straight after a real login, so an unchecked value here is a
  // convincing open redirect.
  const withFrom = (from: string) => ({
    ...req('member@example.com'),
    url: `${BASE_ORIGIN}/auth/complete?from=${encodeURIComponent(from)}`,
  })

  beforeEach(() => mockFind.mockResolvedValue(activeMember))

  it('honours a same-origin path', async () => {
    const res = await call(withFrom('/portal/events'))
    expect(new URL(res.location).pathname).toBe('/portal/events')
  })

  it('keeps a query string on the requested path', async () => {
    const res = await call(withFrom('/portal/photos?album=7'))
    const url = new URL(res.location)
    expect(url.pathname + url.search).toBe('/portal/photos?album=7')
  })

  it.each([
    ['absolute URL',      'https://evil.com/steal'],
    ['protocol-relative', '//evil.com'],
    ['backslash form',    '/\\evil.com'],
    ['scheme',            'javascript:alert(1)'],
    ['relative path',     'portal/events'],
  ])('ignores an off-site %s and falls back to /portal', async (_label, from) => {
    const res = await call(withFrom(from))
    const url = new URL(res.location)
    expect(url.origin).toBe(BASE_ORIGIN)
    expect(url.pathname).toBe('/portal')
    expect(res.location).not.toContain('evil.com')
  })

  it.each(['/login', '/auth/complete', '/join'])(
    'refuses %s as a destination — that is a loop, not a landing page',
    async from => {
      const res = await call(withFrom(from))
      expect(new URL(res.location).pathname).toBe('/portal')
    },
  )

  it('falls back when the request carries no url at all', async () => {
    const res = await call(req('member@example.com'))
    expect(new URL(res.location).pathname).toBe('/portal')
  })
})

describe('/auth/complete — no email from the provider', () => {
  it('rejects without touching the database', async () => {
    const res = await call(req(null))

    expect(res.location).toContain('/login?error=oauth_failed')
    expect(mockFind).not.toHaveBeenCalled()
    expect(mockCreate).not.toHaveBeenCalled()
  })
})
