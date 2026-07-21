/**
 * Contract tests for GET /api/members/search?q=&limit=
 *
 * Guarded by requireSession() (any authenticated member — not admin-only).
 * The route is NOT wrapped in withApiHandler / try-catch, so both the auth
 * guard throwing and searchMembers() rejecting propagate as rejected
 * promises. Queries shorter than 2 chars short-circuit to an empty list
 * without hitting the DB; limit defaults to 10 and is capped at 30.
 * Mocks the session guard and the searchMembers helper (@/lib/db/photos).
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

jest.mock('@/lib/auth/session', () => ({
  requireActiveMember: jest.fn(),
  getSession: jest.fn(),
  requireSession: jest.fn(),
}))
jest.mock('@/lib/db/photos', () => ({
  searchMembers: jest.fn(),
}))

import { GET } from '@/app/api/members/search/route'
import { requireSession } from '@/lib/auth/session'
import { searchMembers } from '@/lib/db/photos'

const get = GET as unknown as (req: unknown) => Promise<{ status: number; body: any }>
const mockRequireSession = requireSession as jest.Mock
const mockSearch = searchMembers as jest.Mock

// Route reads `new URL(req.url)`, so a valid absolute url carrying the
// query string is what matters here.
const makeReq = (qs = '') =>
  ({
    url: `http://x/api/members/search?${qs}`,
    nextUrl: { searchParams: new URLSearchParams(qs) },
    json: async () => ({}),
  } as any)

const matches = [
  { memberId: 'A0001', firstName: 'Amy', lastName: 'Lee' },
  { memberId: 'A0002', firstName: 'Amos', lastName: 'Ng' },
]

beforeEach(() => {
  jest.clearAllMocks()
  mockRequireSession.mockResolvedValue({ memberId: 'A0001', status: 'active' })
  mockSearch.mockResolvedValue([])
})

describe('GET /api/members/search', () => {
  it('rejects (unauthorized) when there is no session, before searching', async () => {
    mockRequireSession.mockRejectedValue(new Error('Unauthorized'))
    await expect(get(makeReq('q=amy'))).rejects.toThrow('Unauthorized')
    expect(mockSearch).not.toHaveBeenCalled()
  })

  it('returns 200 with matches and runs the search with the trimmed query + default limit 10', async () => {
    mockSearch.mockResolvedValue(matches)
    const res = await get(makeReq('q=amy'))
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ ok: true, data: matches })
    expect(mockSearch).toHaveBeenCalledWith('amy', 10)
  })

  it('short-circuits to an empty list (no DB) when the query is under 2 chars', async () => {
    const res = await get(makeReq('q=a'))
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ ok: true, data: [] })
    expect(mockSearch).not.toHaveBeenCalled()
  })

  it('short-circuits to an empty list when the query param is missing', async () => {
    const res = await get(makeReq(''))
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ ok: true, data: [] })
    expect(mockSearch).not.toHaveBeenCalled()
  })

  it('honors an explicit limit and caps it at 30', async () => {
    await get(makeReq('q=amy&limit=5'))
    expect(mockSearch).toHaveBeenLastCalledWith('amy', 5)

    await get(makeReq('q=amy&limit=100'))
    expect(mockSearch).toHaveBeenLastCalledWith('amy', 30)
  })

  it('propagates a DB error (route is unwrapped)', async () => {
    mockSearch.mockRejectedValue(new Error('mysql down'))
    await expect(get(makeReq('q=amy'))).rejects.toThrow('mysql down')
  })
})
