/**
 * Contract tests for GET /api/nyrr/events/[id]
 *
 * Admin-only. Plain params: { params: { id } }. parseInt(id) → 400 if NaN,
 * 404 if row missing, else event + matchPercentage.
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

import { GET } from '@/app/api/nyrr/events/[id]/route'
import { requireSession } from '@/lib/auth/session'
import { isAdmin } from '@/lib/db/admins'
import db from '@/lib/db/connection'

const get = GET as unknown as (req: unknown, ctx: any) => Promise<{ status: number; body: any }>
const mockRequireSession = requireSession as jest.Mock
const mockIsAdmin = isAdmin as jest.Mock
const mockExecute = db.execute as unknown as jest.Mock

const req = {} as any
const ctx = (id: string) => ({ params: { id } })

beforeEach(() => {
  jest.clearAllMocks()
  mockRequireSession.mockResolvedValue({ email: 'admin@mmr.org' })
  mockIsAdmin.mockResolvedValue(true)
})

describe('GET /api/nyrr/events/[id] — auth', () => {
  it('no session → 401', async () => {
    mockRequireSession.mockRejectedValue(new Error('Unauthorized'))
    const res = await get(req, ctx('5'))
    expect(res.status).toBe(401)
    expect(mockExecute).not.toHaveBeenCalled()
  })

  it('non-admin → 403', async () => {
    mockIsAdmin.mockResolvedValue(false)
    const res = await get(req, ctx('5'))
    expect(res.status).toBe(403)
    expect(res.body.error).toBe('Forbidden')
  })
})

describe('GET /api/nyrr/events/[id] — validation & not found', () => {
  it('non-numeric id → 400', async () => {
    const res = await get(req, ctx('abc'))
    expect(res.status).toBe(400)
    expect(res.body.error).toBe('Invalid event ID')
    expect(mockExecute).not.toHaveBeenCalled()
  })

  it('missing row → 404', async () => {
    mockExecute.mockResolvedValue([[]])
    const res = await get(req, ctx('5'))
    expect(res.status).toBe(404)
    expect(res.body.error).toBe('Event not found')
  })
})

describe('GET /api/nyrr/events/[id] — happy path', () => {
  it('returns event with matchPercentage and queries by id', async () => {
    mockExecute.mockResolvedValue([[{ id: 5, mmr_runner_count: 4, mmr_matched_count: 1 }]])
    const res = await get(req, ctx('5'))
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
    expect(res.body.data.matchPercentage).toBe('25.0')
    const [sql, params] = mockExecute.mock.calls[0]
    expect(sql).toMatch(/FROM nyrr_events\s+WHERE id = \?/)
    expect(params).toEqual([5])
  })
})

describe('GET /api/nyrr/events/[id] — DB errors', () => {
  it('query failure → 500', async () => {
    mockExecute.mockRejectedValue(new Error('boom'))
    const res = await get(req, ctx('5'))
    expect(res.status).toBe(500)
    expect(res.body.error).toBe('Internal server error')
  })
})
