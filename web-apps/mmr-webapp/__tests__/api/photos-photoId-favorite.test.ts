/**
 * Contract tests for POST /api/photos/[photoId]/favorite
 *
 * Mocks the session guard and toggleFavorite. Verifies auth (401/403),
 * that the toggled state is echoed back, and the DB error path.
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
jest.mock('@/lib/db/photos', () => ({ toggleFavorite: jest.fn() }))

import { POST } from '@/app/api/photos/[photoId]/favorite/route'
import { requireActiveMember } from '@/lib/auth/session'
import { toggleFavorite } from '@/lib/db/photos'

const post = POST as unknown as (
  req: unknown,
  ctx: { params: { photoId: string } }
) => Promise<{ status: number; body: any }>
const mockRequire = requireActiveMember as jest.Mock
const mockToggle = toggleFavorite as jest.Mock

const MEMBER = { memberId: 'MMR-2026-0001', email: 'a@example.com', status: 'active' }

function httpError(status: number, message = 'x'): Error {
  const err: any = new Error(message)
  err.status = status
  return err
}
const ctx = (photoId: string) => ({ params: { photoId } })

beforeEach(() => {
  jest.clearAllMocks()
  mockRequire.mockResolvedValue(MEMBER)
})

describe('POST /api/photos/[photoId]/favorite', () => {
  it('401 when no session, DB untouched', async () => {
    mockRequire.mockRejectedValue(httpError(401))
    const res = await post({}, ctx('p1'))
    expect(res.status).toBe(401)
    expect(mockToggle).not.toHaveBeenCalled()
  })

  it('403 when member not active', async () => {
    mockRequire.mockRejectedValue(httpError(403, 'Active membership required'))
    const res = await post({}, ctx('p1'))
    expect(res.status).toBe(403)
  })

  it('returns favorited=true when newly starred', async () => {
    mockToggle.mockResolvedValue(true)
    const res = await post({}, ctx('p1'))
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ ok: true, data: { favorited: true } })
    expect(mockToggle).toHaveBeenCalledWith(MEMBER.memberId, 'p1')
  })

  it('returns favorited=false when un-starred', async () => {
    mockToggle.mockResolvedValue(false)
    const res = await post({}, ctx('p1'))
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ ok: true, data: { favorited: false } })
  })

  it('DB error → 500', async () => {
    mockToggle.mockRejectedValue(new Error('boom'))
    const res = await post({}, ctx('p1'))
    expect(res.status).toBe(500)
  })
})
