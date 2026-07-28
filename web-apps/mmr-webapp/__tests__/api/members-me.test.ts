/**
 * Contract tests for /api/members/me
 *
 * GET returns the current session member. Its catch-all maps ANY thrown
 * error — auth guard OR DB — to 401 "Unauthorized"; a missing member row
 * is the only 404. PATCH validates with zod and maps failures to 500
 * "Update failed" (except the Unauthorized rethrow → 401). Mocks the
 * session guard and member helpers at the @/lib/db/members boundary.
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
  requireActiveMember: jest.fn(),
  getSession: jest.fn(),
  requireSession: jest.fn(),
}))
jest.mock('@/lib/db/members', () => ({
  getMemberById: jest.fn(),
  updateMemberProfile: jest.fn(),
}))

import { GET, PATCH } from '@/app/api/members/me/route'
import { requireSession } from '@/lib/auth/session'
import { getMemberById, updateMemberProfile } from '@/lib/db/members'

// tsc sees the real NextResponse types; the runtime mock returns { status, body }.
const get = GET as unknown as () => Promise<{ status: number; body: any }>
const patch = PATCH as unknown as (req: unknown) => Promise<{ status: number; body: any }>

const mockRequireSession = requireSession as jest.Mock
const mockGetMemberById = getMemberById as jest.Mock
const mockUpdateProfile = updateMemberProfile as jest.Mock

const fakeSession = { memberId: 'A0001', email: 'amy@example.com', status: 'active' }
const fakeMember = { memberId: 'A0001', firstName: 'Amy', lastName: 'Lee', status: 'active' }

beforeEach(() => {
  jest.clearAllMocks()
  mockRequireSession.mockResolvedValue(fakeSession)
  mockGetMemberById.mockResolvedValue(fakeMember)
})

// ── GET ────────────────────────────────────────────────────────────────────
describe('GET /api/members/me', () => {
  it('returns 200 with the current session member, keyed by session.memberId', async () => {
    const res = await get()
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ ok: true, data: fakeMember })
    expect(mockGetMemberById).toHaveBeenCalledWith('A0001')
  })

  it('returns 401 when there is no session (guard throws)', async () => {
    mockRequireSession.mockRejectedValue(Object.assign(new Error('Unauthorized'), { status: 401 }))
    const res = await get()
    expect(res.status).toBe(401)
    expect(res.body).toEqual({ ok: false, error: 'Unauthorized' })
    expect(mockGetMemberById).not.toHaveBeenCalled()
  })

  it('returns 404 when the member record does not exist', async () => {
    mockGetMemberById.mockResolvedValue(null)
    const res = await get()
    expect(res.status).toBe(404)
    expect(res.body).toEqual({ ok: false, error: 'Not found' })
  })

  it('maps a DB error to 401 via the generic catch (no leaked 500)', async () => {
    mockGetMemberById.mockRejectedValue(new Error('mysql connection refused'))
    const res = await get()
    expect(res.status).toBe(401)
    expect(res.body).toEqual({ ok: false, error: 'Unauthorized' })
  })
})

// ── PATCH ────────────────────────────────────────────────────────────────────
describe('PATCH /api/members/me', () => {
  const makeReq = (body: unknown) => ({ json: async () => body } as any)

  it('validates input and updates the profile for the session member', async () => {
    mockUpdateProfile.mockResolvedValue(undefined)
    const res = await patch(makeReq({ firstName: 'Amanda' }))
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ ok: true })
    expect(mockUpdateProfile).toHaveBeenCalledWith('A0001', { firstName: 'Amanda' })
  })

  it('returns 401 when unauthenticated', async () => {
    mockRequireSession.mockRejectedValue(Object.assign(new Error('Unauthorized'), { status: 401 }))
    const res = await patch(makeReq({ firstName: 'X' }))
    expect(res.status).toBe(401)
    expect(res.body).toEqual({ ok: false, error: 'Unauthorized' })
    expect(mockUpdateProfile).not.toHaveBeenCalled()
  })

  it('rejects invalid input (yearBorn out of bounds) with 500 "Update failed"', async () => {
    const res = await patch(makeReq({ yearBorn: 1800 }))
    expect(res.status).toBe(500)
    expect(res.body.error).toBe('Update failed')
    expect(mockUpdateProfile).not.toHaveBeenCalled()
  })
})
