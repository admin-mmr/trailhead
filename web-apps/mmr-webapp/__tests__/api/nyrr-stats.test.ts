/**
 * Contract tests for GET /api/nyrr/stats
 *
 * Admin-only (no request arg — export async function GET()). Runs 5 SELECTs:
 * total events, upcoming, sum(mmr_runner_count), unmatched queue, status
 * breakdown. Aggregates into a data object.
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

import { GET } from '@/app/api/nyrr/stats/route'
import { requireSession } from '@/lib/auth/session'
import { isAdmin } from '@/lib/db/admins'
import db from '@/lib/db/connection'

const get = GET as unknown as () => Promise<{ status: number; body: any }>
const mockRequireSession = requireSession as jest.Mock
const mockIsAdmin = isAdmin as jest.Mock
const mockExecute = db.execute as unknown as jest.Mock

beforeEach(() => {
  jest.clearAllMocks()
  mockRequireSession.mockResolvedValue({ email: 'admin@mmr.org' })
  mockIsAdmin.mockResolvedValue(true)
})

describe('GET /api/nyrr/stats — auth', () => {
  it('no session → 401', async () => {
    mockRequireSession.mockRejectedValue(Object.assign(new Error('Unauthorized'), { status: 401 }))
    const res = await get()
    expect(res.status).toBe(401)
    expect(mockExecute).not.toHaveBeenCalled()
  })

  it('non-admin → 403', async () => {
    mockIsAdmin.mockResolvedValue(false)
    const res = await get()
    expect(res.status).toBe(403)
  })
})

describe('GET /api/nyrr/stats — happy path', () => {
  it('aggregates the five queries into a stats object', async () => {
    mockExecute
      .mockResolvedValueOnce([[{ count: 42 }]]) // total events
      .mockResolvedValueOnce([[{ count: 5 }]]) // upcoming
      .mockResolvedValueOnce([[{ total: 300 }]]) // sum mmr runners
      .mockResolvedValueOnce([[{ count: 12 }]]) // unmatched queue
      .mockResolvedValueOnce([
        [
          { processing_status: 'processed', count: 40 },
          { processing_status: 'pending', count: 2 },
        ],
      ]) // status breakdown

    const res = await get()
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
    expect(res.body.data).toEqual({
      totalEvents: 42,
      upcomingEvents: 5,
      totalMmrRunners: 300,
      unmatchedQueueSize: 12,
      statusBreakdown: { processed: 40, pending: 2 },
    })

    expect(mockExecute.mock.calls[3][0]).toMatch(
      /team_code = 'MMR' AND match_method = 'unmatched'/
    )
  })

  it('defaults counts to 0 when result rows are empty', async () => {
    mockExecute
      .mockResolvedValueOnce([[]])
      .mockResolvedValueOnce([[]])
      .mockResolvedValueOnce([[]])
      .mockResolvedValueOnce([[]])
      .mockResolvedValueOnce([[]])
    const res = await get()
    expect(res.body.data.totalEvents).toBe(0)
    expect(res.body.data.totalMmrRunners).toBe(0)
    expect(res.body.data.statusBreakdown).toEqual({})
  })
})

describe('GET /api/nyrr/stats — DB errors', () => {
  it('query failure → 500', async () => {
    mockExecute.mockRejectedValue(new Error('boom'))
    const res = await get()
    expect(res.status).toBe(500)
  })
})
