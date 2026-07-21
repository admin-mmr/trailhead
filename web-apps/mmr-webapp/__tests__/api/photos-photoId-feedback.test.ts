/**
 * Contract tests for POST /api/photos/[photoId]/feedback
 *
 * Mocks the session guard and upsertFeedback. Verifies auth (401/403),
 * rating clamping (1-5), story truncation (2000 chars), the 400 when
 * neither rating nor story is provided, and the DB error path.
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
jest.mock('@/lib/db/photos', () => ({ upsertFeedback: jest.fn() }))

import { POST } from '@/app/api/photos/[photoId]/feedback/route'
import { requireActiveMember } from '@/lib/auth/session'
import { upsertFeedback } from '@/lib/db/photos'

const post = POST as unknown as (
  req: unknown,
  ctx: { params: { photoId: string } }
) => Promise<{ status: number; body: any }>
const mockRequire = requireActiveMember as jest.Mock
const mockUpsert = upsertFeedback as jest.Mock

const MEMBER = { memberId: 'MMR-2026-0001', email: 'a@example.com', status: 'active' }

function httpError(status: number, message = 'x'): Error {
  const err: any = new Error(message)
  err.status = status
  return err
}
const makeReq = (body?: unknown) => ({ json: async () => body }) as any
const ctx = (photoId: string) => ({ params: { photoId } })

beforeEach(() => {
  jest.clearAllMocks()
  mockRequire.mockResolvedValue(MEMBER)
  mockUpsert.mockResolvedValue(undefined)
})

describe('POST /api/photos/[photoId]/feedback', () => {
  it('401 when no session, DB untouched', async () => {
    mockRequire.mockRejectedValue(httpError(401))
    const res = await post(makeReq({ rating: 5 }), ctx('p1'))
    expect(res.status).toBe(401)
    expect(mockUpsert).not.toHaveBeenCalled()
  })

  it('403 when member not active', async () => {
    mockRequire.mockRejectedValue(httpError(403, 'Active membership required'))
    const res = await post(makeReq({ rating: 5 }), ctx('p1'))
    expect(res.status).toBe(403)
  })

  it('400 when neither rating nor story provided', async () => {
    const res = await post(makeReq({}), ctx('p1'))
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/rating or story/i)
    expect(mockUpsert).not.toHaveBeenCalled()
  })

  it('clamps rating into 1-5 and passes story through', async () => {
    const res = await post(makeReq({ rating: 9, story: 'great shot' }), ctx('p1'))
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ ok: true })
    expect(mockUpsert).toHaveBeenCalledWith(MEMBER.memberId, 'p1', 5, 'great shot')
  })

  it('clamps rating below 1 up to 1', async () => {
    await post(makeReq({ rating: 0 }), ctx('p1'))
    expect(mockUpsert).toHaveBeenCalledWith(MEMBER.memberId, 'p1', 1, undefined)
  })

  it('truncates story to 2000 chars', async () => {
    const long = 'x'.repeat(3000)
    await post(makeReq({ story: long }), ctx('p1'))
    const [, , rating, story] = mockUpsert.mock.calls[0]
    expect(rating).toBeUndefined()
    expect(story).toHaveLength(2000)
  })

  it('DB error → 500', async () => {
    mockUpsert.mockRejectedValue(new Error('boom'))
    const res = await post(makeReq({ rating: 3 }), ctx('p1'))
    expect(res.status).toBe(500)
  })
})
