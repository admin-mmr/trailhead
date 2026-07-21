/**
 * Contract tests for GET /api/nyrr/members/[id]
 *
 * Admin-only. NOTE: params is a Promise here — { params: Promise<{ id }> },
 * awaited inside the handler. Two SELECTs: member profile then race history.
 * Missing member → 404.
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

import { GET } from '@/app/api/nyrr/members/[id]/route'
import { requireSession } from '@/lib/auth/session'
import { isAdmin } from '@/lib/db/admins'
import db from '@/lib/db/connection'

const get = GET as unknown as (req: unknown, ctx: any) => Promise<{ status: number; body: any }>
const mockRequireSession = requireSession as jest.Mock
const mockIsAdmin = isAdmin as jest.Mock
const mockExecute = db.execute as unknown as jest.Mock

const req = {} as any
// params is a Promise in this route
const ctx = (id: string) => ({ params: Promise.resolve({ id }) })

beforeEach(() => {
  jest.clearAllMocks()
  mockRequireSession.mockResolvedValue({ email: 'admin@mmr.org' })
  mockIsAdmin.mockResolvedValue(true)
})

describe('GET /api/nyrr/members/[id] — auth', () => {
  it('no session → 401', async () => {
    mockRequireSession.mockRejectedValue(new Error('Unauthorized'))
    const res = await get(req, ctx('A0001'))
    expect(res.status).toBe(401)
    expect(mockExecute).not.toHaveBeenCalled()
  })

  it('non-admin → 403', async () => {
    mockIsAdmin.mockResolvedValue(false)
    const res = await get(req, ctx('A0001'))
    expect(res.status).toBe(403)
  })
})

describe('GET /api/nyrr/members/[id] — not found', () => {
  it('missing member → 404, race history not queried', async () => {
    mockExecute.mockResolvedValueOnce([[]])
    const res = await get(req, ctx('A0001'))
    expect(res.status).toBe(404)
    expect(res.body.error).toBe('Member not found')
    expect(mockExecute).toHaveBeenCalledTimes(1)
  })
})

describe('GET /api/nyrr/members/[id] — happy path', () => {
  it('returns member + races, queries both by member id', async () => {
    const member = { MemberID: 'A0001', FirstName: 'Amy', LastName: 'Zed' }
    const races = [{ id: 7, event_name: 'NYC Half' }]
    mockExecute.mockResolvedValueOnce([[member]]).mockResolvedValueOnce([races])

    const res = await get(req, ctx('A0001'))
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
    expect(res.body.data.member).toEqual(member)
    expect(res.body.data.races).toEqual(races)

    const [memberSql, memberParams] = mockExecute.mock.calls[0]
    expect(memberSql).toMatch(/FROM members WHERE MemberID = \?/)
    expect(memberParams).toEqual(['A0001'])

    const [raceSql, raceParams] = mockExecute.mock.calls[1]
    expect(raceSql).toMatch(/FROM nyrr_event_runners r/)
    expect(raceSql).toMatch(/JOIN nyrr_events e/)
    expect(raceSql).toMatch(/WHERE r\.mmr_member_id = \?/)
    expect(raceParams).toEqual(['A0001'])
  })
})

describe('GET /api/nyrr/members/[id] — DB errors', () => {
  it('query failure → 500', async () => {
    mockExecute.mockRejectedValue(new Error('boom'))
    const res = await get(req, ctx('A0001'))
    expect(res.status).toBe(500)
  })
})
