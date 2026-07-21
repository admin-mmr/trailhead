/**
 * Contract tests for DELETE /api/bibs/[id]
 *
 * Route uses the default `pool` import and calls pool.query directly.
 * Verifies auth (401/403), id validation (400), ownership-scoped DELETE
 * SQL + params, the 404 when nothing was deleted, and the DB error path.
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
  requireActiveMember: jest.fn(),
  getSession: jest.fn(),
  requireSession: jest.fn(),
}))
jest.mock('@/lib/db/connection', () => {
  const query = jest.fn()
  return {
    __esModule: true,
    default: { query },
    pool: { query, getConnection: jest.fn() },
    getDb: jest.fn(),
  }
})

import { DELETE } from '@/app/api/bibs/[id]/route'
import { requireActiveMember } from '@/lib/auth/session'
import pool from '@/lib/db/connection'

const del = DELETE as unknown as (
  req: unknown,
  ctx: { params: { id: string } }
) => Promise<{ status: number; body: any }>

const mockRequire = requireActiveMember as jest.Mock
const mockQuery = (pool as any).query as jest.Mock

const MEMBER = { memberId: 'MMR-2026-0001', email: 'a@example.com', status: 'active' }

function httpError(status: number, message = 'x'): Error {
  const err: any = new Error(message)
  err.status = status
  return err
}
const ctx = (id: string) => ({ params: { id } })

beforeEach(() => {
  jest.clearAllMocks()
  mockRequire.mockResolvedValue(MEMBER)
})

describe('DELETE /api/bibs/[id]', () => {
  it('401 when no session, DB untouched', async () => {
    mockRequire.mockRejectedValue(httpError(401))
    const res = await del({}, ctx('5'))
    expect(res.status).toBe(401)
    expect(mockQuery).not.toHaveBeenCalled()
  })

  it('403 when member not active', async () => {
    mockRequire.mockRejectedValue(httpError(403, 'Active membership required'))
    const res = await del({}, ctx('5'))
    expect(res.status).toBe(403)
  })

  it.each(['0', '-1', 'abc'])('400 for invalid id "%s"', async (id) => {
    const res = await del({}, ctx(id))
    expect(res.status).toBe(400)
    expect(res.body.error).toBe('Invalid id')
    expect(mockQuery).not.toHaveBeenCalled()
  })

  it('happy path deletes own self-assigned bib', async () => {
    mockQuery.mockResolvedValue([{ affectedRows: 1 }])
    const res = await del({}, ctx('7'))
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ ok: true })

    const [sql, params] = mockQuery.mock.calls[0]
    expect(sql).toMatch(/DELETE FROM member_bib_assignments/)
    expect(sql).toMatch(/source = 'member_self'/)
    expect(params).toEqual([7, MEMBER.memberId])
  })

  it('404 when nothing deleted (not owned / wrong source)', async () => {
    mockQuery.mockResolvedValue([{ affectedRows: 0 }])
    const res = await del({}, ctx('7'))
    expect(res.status).toBe(404)
    expect(res.body.error).toMatch(/not found or cannot be deleted/i)
  })

  it('DB error → 500', async () => {
    mockQuery.mockRejectedValue(new Error('connect ETIMEDOUT'))
    const res = await del({}, ctx('7'))
    expect(res.status).toBe(500)
    expect(res.body.error).toBe('Internal server error')
  })
})
