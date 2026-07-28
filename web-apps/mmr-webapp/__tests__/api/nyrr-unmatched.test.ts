/**
 * Contract tests for GET /api/nyrr/unmatched
 *
 * Admin-only. Single grouped query of unmatched MMR runners; runners_json is
 * a GROUP_CONCAT of JSON objects re-parsed as an array per event.
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

import { GET } from '@/app/api/nyrr/unmatched/route'
import { requireSession } from '@/lib/auth/session'
import { isAdmin } from '@/lib/db/admins'
import db from '@/lib/db/connection'

const get = GET as unknown as (req: unknown) => Promise<{ status: number; body: any }>
const mockRequireSession = requireSession as jest.Mock
const mockIsAdmin = isAdmin as jest.Mock
const mockExecute = db.execute as unknown as jest.Mock

const req = {} as any

beforeEach(() => {
  jest.clearAllMocks()
  mockRequireSession.mockResolvedValue({ email: 'admin@mmr.org' })
  mockIsAdmin.mockResolvedValue(true)
})

describe('GET /api/nyrr/unmatched — auth', () => {
  it('no session → 401', async () => {
    mockRequireSession.mockRejectedValue(Object.assign(new Error('Unauthorized'), { status: 401 }))
    const res = await get(req)
    expect(res.status).toBe(401)
    expect(mockExecute).not.toHaveBeenCalled()
  })

  it('non-admin → 403', async () => {
    mockIsAdmin.mockResolvedValue(false)
    const res = await get(req)
    expect(res.status).toBe(403)
  })
})

describe('GET /api/nyrr/unmatched — happy path', () => {
  it('maps rows and parses runners_json into a runners array', async () => {
    const rows = [
      {
        event_id: 5,
        event_code: 'B2026',
        event_name: 'Brooklyn Half',
        event_date: '2026-05-01',
        event_year: 2026,
        location: 'Brooklyn',
        unmatched_count: 1,
        runners_json: JSON.stringify({ id: 11, runner_name: 'Amy Zed' }),
      },
    ]
    mockExecute.mockResolvedValue([rows])

    const res = await get(req)
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
    expect(res.body.data[0]).toMatchObject({
      eventId: 5,
      eventCode: 'B2026',
      unmatchedCount: 1,
    })
    expect(res.body.data[0].runners).toEqual([{ id: 11, runner_name: 'Amy Zed' }])

    const [sql] = mockExecute.mock.calls[0]
    expect(sql).toMatch(/WHERE r\.team_code = 'MMR' AND r\.match_method = 'unmatched'/)
    expect(sql).toMatch(/GROUP BY e\.id/)
    expect(sql).toMatch(/ORDER BY e\.event_date DESC/)
  })

  it('yields empty runners array when runners_json is null', async () => {
    mockExecute.mockResolvedValue([[{ event_id: 1, runners_json: null }]])
    const res = await get(req)
    expect(res.body.data[0].runners).toEqual([])
  })

  it('returns empty data when no unmatched runners', async () => {
    mockExecute.mockResolvedValue([[]])
    const res = await get(req)
    expect(res.body.data).toEqual([])
  })
})

describe('GET /api/nyrr/unmatched — DB errors', () => {
  it('query failure → 500', async () => {
    mockExecute.mockRejectedValue(new Error('boom'))
    const res = await get(req)
    expect(res.status).toBe(500)
  })
})
