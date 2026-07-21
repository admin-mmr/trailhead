/**
 * Contract tests for GET /api/nyrr/events
 *
 * Admin-only route: requireSession() (throws Error('Unauthorized') → 401),
 * then isAdmin(session.email) (false → 403). Uses default-export db.execute().
 * Verifies auth guards, happy-path SQL + pagination shape, filter params,
 * and the DB error path.
 */

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
  requireSession: jest.fn(),
  getSession: jest.fn(),
  requireActiveMember: jest.fn(),
}))
jest.mock('@/lib/db/admins', () => ({ isAdmin: jest.fn() }))
jest.mock('@/lib/db/connection', () => ({
  __esModule: true,
  default: { execute: jest.fn(), getConnection: jest.fn() },
  pool: { getConnection: jest.fn() },
  getDb: jest.fn(),
}))

import { GET } from '@/app/api/nyrr/events/route'
import { requireSession } from '@/lib/auth/session'
import { isAdmin } from '@/lib/db/admins'
import db from '@/lib/db/connection'

const get = GET as unknown as (req: unknown, ctx?: any) => Promise<{ status: number; body: any }>
const mockRequireSession = requireSession as jest.Mock
const mockIsAdmin = isAdmin as jest.Mock
const mockExecute = db.execute as unknown as jest.Mock

const makeReq = (url = 'http://x/api/nyrr/events') =>
  ({ url, nextUrl: { searchParams: new URLSearchParams(url.split('?')[1] || '') } } as any)

beforeEach(() => {
  jest.clearAllMocks()
  mockRequireSession.mockResolvedValue({ email: 'admin@mmr.org' })
  mockIsAdmin.mockResolvedValue(true)
})

describe('GET /api/nyrr/events — auth', () => {
  it('no session → 401, DB untouched', async () => {
    mockRequireSession.mockRejectedValue(new Error('Unauthorized'))
    const res = await get(makeReq())
    expect(res.status).toBe(401)
    expect(res.body.error).toBe('Unauthorized')
    expect(mockExecute).not.toHaveBeenCalled()
  })

  it('non-admin → 403, DB untouched', async () => {
    mockIsAdmin.mockResolvedValue(false)
    const res = await get(makeReq())
    expect(res.status).toBe(403)
    expect(res.body.error).toBe('Forbidden')
    expect(mockExecute).not.toHaveBeenCalled()
  })
})

describe('GET /api/nyrr/events — happy path', () => {
  it('returns events with computed matchPercentage', async () => {
    const rows = [
      { id: 10, event_code: 'B2026', mmr_runner_count: 10, mmr_matched_count: 5 },
    ]
    mockExecute.mockResolvedValue([rows])
    const res = await get(makeReq())
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
    expect(res.body.data[0].matchPercentage).toBe('50.0')
    expect(res.body.pagination.hasMore).toBe(false)

    const [sql, params] = mockExecute.mock.calls[0]
    expect(sql).toMatch(/FROM nyrr_events/)
    expect(sql).toMatch(/ORDER BY event_date DESC LIMIT \?/)
    expect(params).toEqual([21]) // default limit 20 + 1
  })

  it('matchPercentage is 0 when mmr_runner_count is 0', async () => {
    mockExecute.mockResolvedValue([[{ id: 1, mmr_runner_count: 0, mmr_matched_count: 0 }]])
    const res = await get(makeReq())
    expect(res.body.data[0].matchPercentage).toBe(0)
  })

  it('applies status, year and cursor filters as SQL params', async () => {
    mockExecute.mockResolvedValue([[]])
    await get(makeReq('http://x/api/nyrr/events?status=pending&year=2026&cursor=99&limit=5'))
    const [sql, params] = mockExecute.mock.calls[0]
    expect(sql).toMatch(/AND processing_status = \?/)
    expect(sql).toMatch(/AND event_year = \?/)
    expect(sql).toMatch(/AND id < \?/)
    expect(params).toEqual(['pending', 2026, 99, 6])
  })

  it('sets hasMore + nextCursor when more rows than limit', async () => {
    mockExecute.mockResolvedValue([
      [
        { id: 3, mmr_runner_count: 0, mmr_matched_count: 0 },
        { id: 2, mmr_runner_count: 0, mmr_matched_count: 0 },
      ],
    ])
    const res = await get(makeReq('http://x/api/nyrr/events?limit=1'))
    expect(res.body.pagination.hasMore).toBe(true)
    expect(res.body.data).toHaveLength(1)
    expect(res.body.pagination.nextCursor).toBe(3)
  })
})

describe('GET /api/nyrr/events — DB errors', () => {
  it('query failure → 500', async () => {
    mockExecute.mockRejectedValue(new Error('connect ETIMEDOUT'))
    const res = await get(makeReq())
    expect(res.status).toBe(500)
    expect(res.body.error).toBe('Internal server error')
  })
})
