/**
 * Contract tests for GET /api/photos/my
 *
 * Mocks the session guard and getPhotosByMember. Verifies auth (401/403),
 * the default (self) lookup, the ?memberId friend lookup, and pagination
 * params passed through to the helper.
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
jest.mock('@/lib/db/photos', () => ({ getPhotosByMember: jest.fn() }))

import { GET } from '@/app/api/photos/my/route'
import { requireActiveMember } from '@/lib/auth/session'
import { getPhotosByMember } from '@/lib/db/photos'

const get = GET as unknown as (req: unknown) => Promise<{ status: number; body: any }>
const mockRequire = requireActiveMember as jest.Mock
const mockGet = getPhotosByMember as jest.Mock

const MEMBER = { memberId: 'MMR-2026-0001', email: 'a@example.com', status: 'active' }

function httpError(status: number, message = 'x'): Error {
  const err: any = new Error(message)
  err.status = status
  return err
}
const makeReq = (qs = '') =>
  ({ nextUrl: { searchParams: new URLSearchParams(qs) } }) as any

beforeEach(() => {
  jest.clearAllMocks()
  mockRequire.mockResolvedValue(MEMBER)
  mockGet.mockResolvedValue([])
})

describe('GET /api/photos/my', () => {
  it('401 when no session, DB untouched', async () => {
    mockRequire.mockRejectedValue(httpError(401))
    const res = await get(makeReq())
    expect(res.status).toBe(401)
    expect(mockGet).not.toHaveBeenCalled()
  })

  it('403 when member not active', async () => {
    mockRequire.mockRejectedValue(httpError(403, 'Active membership required'))
    const res = await get(makeReq())
    expect(res.status).toBe(403)
  })

  it('defaults to own photos with default pagination', async () => {
    const photos = [{ photoId: 'p1' }]
    mockGet.mockResolvedValue(photos)
    const res = await get(makeReq())
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ ok: true, data: photos })
    expect(mockGet).toHaveBeenCalledWith(MEMBER.memberId, MEMBER.memberId, 1, 40)
  })

  it('honors ?memberId friend lookup + pagination params', async () => {
    const res = await get(makeReq('memberId=A0042&page=3&pageSize=10'))
    expect(res.status).toBe(200)
    expect(mockGet).toHaveBeenCalledWith('A0042', MEMBER.memberId, 3, 10)
  })

  it('DB error → 500', async () => {
    mockGet.mockRejectedValue(new Error('boom'))
    const res = await get(makeReq())
    expect(res.status).toBe(500)
    expect(res.body.error).toBe('Internal server error')
  })
})
