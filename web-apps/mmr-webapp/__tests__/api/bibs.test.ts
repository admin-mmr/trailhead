/**
 * Contract tests for /api/bibs (GET + POST)
 *
 * Mocks the session guard and the @/lib/db/photos helpers. Verifies auth
 * (401/403), the happy-path helper calls, and POST input validation.
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
jest.mock('@/lib/db/photos', () => ({
  getMemberBibAssignments: jest.fn(),
  upsertBibAssignment: jest.fn(),
}))

import { GET, POST } from '@/app/api/bibs/route'
import { requireActiveMember } from '@/lib/auth/session'
import { getMemberBibAssignments, upsertBibAssignment } from '@/lib/db/photos'

const get = GET as unknown as (req?: unknown) => Promise<{ status: number; body: any }>
const post = POST as unknown as (req: unknown) => Promise<{ status: number; body: any }>

const mockRequire = requireActiveMember as jest.Mock
const mockGetBibs = getMemberBibAssignments as jest.Mock
const mockUpsert = upsertBibAssignment as jest.Mock

const MEMBER = { memberId: 'MMR-2026-0001', email: 'a@example.com', status: 'active' }

function httpError(status: number, message = 'x'): Error {
  const err: any = new Error(message)
  err.status = status
  return err
}
const makeReq = (body?: unknown) => ({ json: async () => body }) as any

beforeEach(() => {
  jest.clearAllMocks()
  mockRequire.mockResolvedValue(MEMBER)
})

describe('GET /api/bibs', () => {
  it('401 when no session', async () => {
    mockRequire.mockRejectedValue(httpError(401, 'Unauthorized'))
    const res = await get()
    expect(res.status).toBe(401)
    expect(mockGetBibs).not.toHaveBeenCalled()
  })

  it('403 when member not active', async () => {
    mockRequire.mockRejectedValue(httpError(403, 'Active membership required'))
    const res = await get()
    expect(res.status).toBe(403)
  })

  it('happy path returns the member bib assignments', async () => {
    const bibs = [{ id: 1, eventId: 'E1', bibNumber: '1234' }]
    mockGetBibs.mockResolvedValue(bibs)
    const res = await get()
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ ok: true, data: bibs })
    expect(mockGetBibs).toHaveBeenCalledWith(MEMBER.memberId)
  })
})

describe('POST /api/bibs', () => {
  it('401 when no session, DB untouched', async () => {
    mockRequire.mockRejectedValue(httpError(401))
    const res = await post(makeReq({ eventId: 'E1', bibNumber: '1234' }))
    expect(res.status).toBe(401)
    expect(mockUpsert).not.toHaveBeenCalled()
  })

  it('400 when eventId or bibNumber missing', async () => {
    const res = await post(makeReq({ eventId: 'E1' }))
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/required/i)
    expect(mockUpsert).not.toHaveBeenCalled()
  })

  it('400 when bibNumber has no digits', async () => {
    const res = await post(makeReq({ eventId: 'E1', bibNumber: 'abc' }))
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/Invalid bib number/)
    expect(mockUpsert).not.toHaveBeenCalled()
  })

  it('happy path strips non-digits and upserts as member_self', async () => {
    mockUpsert.mockResolvedValue(undefined)
    const res = await post(makeReq({ eventId: 'E1', bibNumber: ' #12-34 ' }))
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ ok: true })
    expect(mockUpsert).toHaveBeenCalledWith(MEMBER.memberId, 'E1', '1234', 'member_self')
  })

  it('DB error → 500', async () => {
    mockUpsert.mockRejectedValue(new Error('connect ETIMEDOUT'))
    const res = await post(makeReq({ eventId: 'E1', bibNumber: '1234' }))
    expect(res.status).toBe(500)
    expect(res.body.error).toBe('Internal server error')
  })
})
