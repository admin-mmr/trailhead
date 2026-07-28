/**
 * Contract tests for GET /api/nyrr/events/[id]/runners
 *
 * Admin-only. Paginated runner list with filter (all/mmr/matched/unmatched/
 * not_member) and cursor. LEFT JOIN members. parseInt(id) → 400 if NaN.
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

import { GET } from '@/app/api/nyrr/events/[id]/runners/route'
import { requireSession } from '@/lib/auth/session'
import { isAdmin } from '@/lib/db/admins'
import db from '@/lib/db/connection'

const get = GET as unknown as (req: unknown, ctx: any) => Promise<{ status: number; body: any }>
const mockRequireSession = requireSession as jest.Mock
const mockIsAdmin = isAdmin as jest.Mock
const mockExecute = db.execute as unknown as jest.Mock

const makeReq = (url = 'http://x/api/nyrr/events/5/runners') =>
  ({ url, nextUrl: { searchParams: new URLSearchParams(url.split('?')[1] || '') } } as any)
const ctx = (id: string) => ({ params: { id } })

beforeEach(() => {
  jest.clearAllMocks()
  mockRequireSession.mockResolvedValue({ email: 'admin@mmr.org' })
  mockIsAdmin.mockResolvedValue(true)
})

describe('GET /api/nyrr/events/[id]/runners — auth & validation', () => {
  it('no session → 401', async () => {
    mockRequireSession.mockRejectedValue(Object.assign(new Error('Unauthorized'), { status: 401 }))
    const res = await get(makeReq(), ctx('5'))
    expect(res.status).toBe(401)
    expect(mockExecute).not.toHaveBeenCalled()
  })

  it('non-admin → 403', async () => {
    mockIsAdmin.mockResolvedValue(false)
    const res = await get(makeReq(), ctx('5'))
    expect(res.status).toBe(403)
  })

  it('non-numeric id → 400', async () => {
    const res = await get(makeReq(), ctx('nope'))
    expect(res.status).toBe(400)
    expect(res.body.error).toBe('Invalid event ID')
    expect(mockExecute).not.toHaveBeenCalled()
  })
})

describe('GET /api/nyrr/events/[id]/runners — happy path', () => {
  it('returns runners with default filter and event-id param', async () => {
    mockExecute.mockResolvedValue([[{ id: 1, runner_name: 'Amy Zed' }]])
    const res = await get(makeReq(), ctx('5'))
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
    expect(res.body.pagination.hasMore).toBe(false)
    const [sql, params] = mockExecute.mock.calls[0]
    expect(sql).toMatch(/FROM nyrr_event_runners r/)
    expect(sql).toMatch(/LEFT JOIN members m/)
    expect(sql).toMatch(/WHERE r\.nyrr_event_id = \?/)
    expect(params).toEqual([5, 51]) // default limit 50 + 1
  })

  it('applies filter=unmatched and cursor to SQL', async () => {
    mockExecute.mockResolvedValue([[]])
    await get(makeReq('http://x/r?filter=unmatched&cursor=42&limit=10'), ctx('5'))
    const [sql, params] = mockExecute.mock.calls[0]
    expect(sql).toMatch(/AND r\.team_code = 'MMR' AND r\.match_method = 'unmatched'/)
    expect(sql).toMatch(/AND r\.id < \?/)
    expect(params).toEqual([5, 42, 11])
  })

  it('sets hasMore + nextCursor when rows exceed limit', async () => {
    mockExecute.mockResolvedValue([[{ id: 9 }, { id: 8 }]])
    const res = await get(makeReq('http://x/r?limit=1'), ctx('5'))
    expect(res.body.pagination.hasMore).toBe(true)
    expect(res.body.data).toHaveLength(1)
    expect(res.body.pagination.nextCursor).toBe(9)
  })
})

describe('GET /api/nyrr/events/[id]/runners — DB errors', () => {
  it('query failure → 500', async () => {
    mockExecute.mockRejectedValue(new Error('boom'))
    const res = await get(makeReq(), ctx('5'))
    expect(res.status).toBe(500)
  })
})
