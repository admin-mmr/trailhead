/**
 * Contract tests for GET /api/payments/pending
 *
 * Mocks the mysql2 pool and the custom JWT session helper. Verifies:
 * 401 without a session, happy-path SQL params + { events } response
 * shape, and the DB error path.
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
  getSession: jest.fn(),
}))
jest.mock('@/lib/db/connection', () => ({
  pool: { getConnection: jest.fn() },
  getDb: jest.fn(),
}))

import { GET } from '@/app/api/payments/pending/route'

// tsc sees the real NextResponse types; the runtime mock returns { status, body }.
const get = GET as unknown as (req: unknown) => Promise<{ status: number; body: any }>
import { getSession } from '@/lib/auth/session'
import { pool } from '@/lib/db/connection'

const mockGetSession = getSession as jest.Mock
const mockGetConnection = pool.getConnection as jest.Mock

const req = {} as any

let conn: { execute: jest.Mock; release: jest.Mock }

beforeEach(() => {
  jest.clearAllMocks()
  conn = { execute: jest.fn(), release: jest.fn() }
  mockGetConnection.mockResolvedValue(conn)
})

describe('GET /api/payments/pending — auth', () => {
  it('no session → 401, DB untouched', async () => {
    mockGetSession.mockResolvedValue(null)
    const res = await get(req)
    expect(res.status).toBe(401)
    expect(res.body.error).toBe('Unauthorized')
    expect(mockGetConnection).not.toHaveBeenCalled()
  })
})

describe('GET /api/payments/pending — happy path', () => {
  const ROWS = [
    {
      event_id: 'SUB-20260701-ABC12',
      payment_intent: 'Individual Membership',
      amount: 30,
      payment_method: 'zelle',
      created_at: '2026-07-01T12:00:00.000Z',
      proof_url: null,
    },
  ]

  it('queries pending submissions by session email and returns { events }', async () => {
    mockGetSession.mockResolvedValue({ memberId: 'MMR-2026-0042', email: 'amy@example.com', status: 'pending' })
    conn.execute.mockResolvedValue([ROWS])

    const res = await get(req)

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ events: ROWS })

    const [sql, params] = conn.execute.mock.calls[0]
    expect(sql).toMatch(/FROM submissions/)
    expect(sql).toMatch(/Status = 'pending'/)
    expect(sql).toMatch(/SELECT MemberID FROM members WHERE Email = \?/)
    expect(params).toEqual(['amy@example.com'])
    expect(conn.release).toHaveBeenCalled()
  })

  it('returns empty events array when member has no pending submissions', async () => {
    mockGetSession.mockResolvedValue({ email: 'amy@example.com' })
    conn.execute.mockResolvedValue([[]])
    const res = await get(req)
    expect(res.status).toBe(200)
    expect(res.body.events).toEqual([])
  })
})

describe('GET /api/payments/pending — DB errors', () => {
  it('query failure → 500, connection still released', async () => {
    mockGetSession.mockResolvedValue({ email: 'amy@example.com' })
    conn.execute.mockRejectedValue(new Error('connect ETIMEDOUT'))
    const res = await get(req)
    expect(res.status).toBe(500)
    expect(res.body.error).toBe('Internal server error')
    expect(conn.release).toHaveBeenCalled()
  })
})
