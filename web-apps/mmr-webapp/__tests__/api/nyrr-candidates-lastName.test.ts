/**
 * Contract tests for GET /api/nyrr/candidates/[lastName]
 *
 * Admin-only. Plain params: { params: { lastName } }. Empty lastName → 400.
 * Case-insensitive member lookup by LastName.
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

import { GET } from '@/app/api/nyrr/candidates/[lastName]/route'
import { requireSession } from '@/lib/auth/session'
import { isAdmin } from '@/lib/db/admins'
import db from '@/lib/db/connection'

const get = GET as unknown as (req: unknown, ctx: any) => Promise<{ status: number; body: any }>
const mockRequireSession = requireSession as jest.Mock
const mockIsAdmin = isAdmin as jest.Mock
const mockExecute = db.execute as unknown as jest.Mock

const req = {} as any
const ctx = (lastName: string) => ({ params: { lastName } })

beforeEach(() => {
  jest.clearAllMocks()
  mockRequireSession.mockResolvedValue({ email: 'admin@mmr.org' })
  mockIsAdmin.mockResolvedValue(true)
})

describe('GET /api/nyrr/candidates/[lastName] — auth & validation', () => {
  it('no session → 401', async () => {
    mockRequireSession.mockRejectedValue(new Error('Unauthorized'))
    const res = await get(req, ctx('Smith'))
    expect(res.status).toBe(401)
    expect(mockExecute).not.toHaveBeenCalled()
  })

  it('non-admin → 403', async () => {
    mockIsAdmin.mockResolvedValue(false)
    const res = await get(req, ctx('Smith'))
    expect(res.status).toBe(403)
  })

  it('empty lastName → 400', async () => {
    const res = await get(req, ctx(''))
    expect(res.status).toBe(400)
    expect(res.body.error).toBe('Last name is required')
    expect(mockExecute).not.toHaveBeenCalled()
  })
})

describe('GET /api/nyrr/candidates/[lastName] — happy path', () => {
  it('queries members case-insensitively and returns data', async () => {
    const rows = [{ MemberID: 'A0001', FirstName: 'Amy', LastName: 'Smith' }]
    mockExecute.mockResolvedValue([rows])
    const res = await get(req, ctx('Smith'))
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
    expect(res.body.data).toEqual(rows)
    const [sql, params] = mockExecute.mock.calls[0]
    expect(sql).toMatch(/FROM members/)
    expect(sql).toMatch(/WHERE LOWER\(LastName\) = LOWER\(\?\)/)
    expect(params).toEqual(['Smith'])
  })

  it('returns empty array when no matches', async () => {
    mockExecute.mockResolvedValue([[]])
    const res = await get(req, ctx('Nobody'))
    expect(res.status).toBe(200)
    expect(res.body.data).toEqual([])
  })
})

describe('GET /api/nyrr/candidates/[lastName] — DB errors', () => {
  it('query failure → 500', async () => {
    mockExecute.mockRejectedValue(new Error('boom'))
    const res = await get(req, ctx('Smith'))
    expect(res.status).toBe(500)
  })
})
