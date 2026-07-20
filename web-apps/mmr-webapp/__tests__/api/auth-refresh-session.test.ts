/**
 * Contract tests for POST /api/auth/refresh-session
 *
 * Mocks session helpers, member lookup, and the NextAuth `auth()` export.
 * Verifies: 401 when neither session exists, the NextAuth fallback path,
 * 404 for a vanished member, fresh-JWT issuance + cookie on the happy
 * path, expired-active status downgrade, and the DB error path.
 */

// ── Mock next/server (json responses carry a per-response cookies.set) ───────
jest.mock('next/server', () => ({
  NextRequest: class {},
  NextResponse: {
    json: jest.fn((body: unknown, init?: { status?: number }) => ({
      status: init?.status ?? 200,
      body,
      cookies: { set: jest.fn() },
    })),
  },
}))

jest.mock('@/lib/auth/session', () => ({
  getSession: jest.fn(),
  createSession: jest.fn(),
  setSessionCookie: jest.fn((token: string) => ({ name: 'mmr_session', value: token })),
}))
jest.mock('@/lib/db/members', () => ({
  findMemberByEmail: jest.fn(),
}))
jest.mock('@/auth', () => ({
  auth: jest.fn(),
}))

import { POST } from '@/app/api/auth/refresh-session/route'

// tsc sees the real NextResponse types; the runtime mock returns { status, body, cookies }.
const post = POST as unknown as (req: unknown) => Promise<{ status: number; body: any; cookies: { set: jest.Mock } }>
import { getSession, createSession, setSessionCookie } from '@/lib/auth/session'
import { findMemberByEmail } from '@/lib/db/members'
import { auth } from '@/auth'

const mockGetSession = getSession as jest.Mock
const mockCreateSession = createSession as jest.Mock
const mockSetSessionCookie = setSessionCookie as unknown as jest.Mock
const mockFindByEmail = findMemberByEmail as jest.Mock
const mockAuth = auth as unknown as jest.Mock

const EMAIL = 'amy@example.com'

function member(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    memberId: 'MMR-2026-0042',
    email: EMAIL,
    firstName: 'Amy',
    lastName: 'Lee',
    status: 'active',
    expiresAt: new Date(Date.now() + 180 * 24 * 3600 * 1000).toISOString(),  // +180d
    ...overrides,
  }
}

const req = {} as any

beforeEach(() => {
  jest.clearAllMocks()
  mockGetSession.mockResolvedValue({ memberId: 'MMR-2026-0042', email: EMAIL, status: 'inactive' })
  mockAuth.mockResolvedValue(null)
  mockFindByEmail.mockResolvedValue(member())
  mockCreateSession.mockResolvedValue('fresh.jwt.token')
})

// ── Auth gating ───────────────────────────────────────────────────────────────

describe('POST /api/auth/refresh-session — auth gating', () => {
  it('no mmr_session and no NextAuth session → 401', async () => {
    mockGetSession.mockResolvedValue(null)
    mockAuth.mockResolvedValue(null)
    const res = await post(req)
    expect(res.status).toBe(401)
    expect(res.body.error).toBe('Not authenticated.')
    expect(mockFindByEmail).not.toHaveBeenCalled()
  })

  it('falls back to the NextAuth session when mmr_session is expired', async () => {
    mockGetSession.mockResolvedValue(null)
    mockAuth.mockResolvedValue({ user: { email: EMAIL } })
    const res = await post(req)
    expect(res.status).toBe(200)
    expect(mockFindByEmail).toHaveBeenCalledWith(EMAIL)
  })
})

// ── Member lookup ─────────────────────────────────────────────────────────────

describe('POST /api/auth/refresh-session — member lookup', () => {
  it('member not found → 404', async () => {
    mockFindByEmail.mockResolvedValue(null)
    const res = await post(req)
    expect(res.status).toBe(404)
    expect(res.body.error).toBe('Member not found.')
    expect(mockCreateSession).not.toHaveBeenCalled()
  })
})

// ── Happy path ────────────────────────────────────────────────────────────────

describe('POST /api/auth/refresh-session — happy path', () => {
  it('issues a fresh JWT with the current status and sets the cookie', async () => {
    const res = await post(req)

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ status: 'active' })

    expect(mockCreateSession).toHaveBeenCalledWith({
      memberId: 'MMR-2026-0042',
      email: EMAIL,
      firstName: 'Amy',
      lastName: 'Lee',
      status: 'active',
    })
    expect(mockSetSessionCookie).toHaveBeenCalledWith('fresh.jwt.token')
    expect(res.cookies.set).toHaveBeenCalledWith({ name: 'mmr_session', value: 'fresh.jwt.token' })
  })

  it('downgrades an active member with a past expiration to "expired"', async () => {
    mockFindByEmail.mockResolvedValue(member({
      expiresAt: new Date(Date.now() - 24 * 3600 * 1000).toISOString(),  // yesterday
    }))
    const res = await post(req)
    expect(res.body).toEqual({ status: 'expired' })
    expect(mockCreateSession.mock.calls[0][0].status).toBe('expired')
  })

  it('does not downgrade non-active statuses even without expiresAt', async () => {
    mockFindByEmail.mockResolvedValue(member({ status: 'pending', expiresAt: undefined }))
    const res = await post(req)
    expect(res.body).toEqual({ status: 'pending' })
  })
})

// ── DB error path ─────────────────────────────────────────────────────────────

describe('POST /api/auth/refresh-session — DB errors', () => {
  it('member lookup failure → 500', async () => {
    mockFindByEmail.mockRejectedValue(new Error('connect ETIMEDOUT'))
    const res = await post(req)
    expect(res.status).toBe(500)
    expect(res.body.error).toBe('Failed to refresh session.')
  })
})
