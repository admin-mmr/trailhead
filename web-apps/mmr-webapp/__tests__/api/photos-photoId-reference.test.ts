/**
 * Contract tests for POST /api/photos/[photoId]/reference
 *
 * Route uses the default `pool` import (pool.query) to verify the detection
 * belongs to the photo/member, then calls addReferencePhoto. Verifies auth
 * (401/403), body validation (400), the ownership 404, the happy-path SQL
 * params + helper call, and the DB error path.
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
jest.mock('@/lib/db/photos', () => ({ addReferencePhoto: jest.fn() }))
jest.mock('@/lib/db/connection', () => {
  const query = jest.fn()
  return {
    __esModule: true,
    default: { query },
    pool: { query, getConnection: jest.fn() },
    getDb: jest.fn(),
  }
})

import { POST } from '@/app/api/photos/[photoId]/reference/route'
import { requireActiveMember } from '@/lib/auth/session'
import { addReferencePhoto } from '@/lib/db/photos'
import pool from '@/lib/db/connection'

const post = POST as unknown as (
  req: unknown,
  ctx: { params: { photoId: string } }
) => Promise<{ status: number; body: any }>
const mockRequire = requireActiveMember as jest.Mock
const mockAdd = addReferencePhoto as jest.Mock
const mockQuery = (pool as any).query as jest.Mock

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
})

describe('POST /api/photos/[photoId]/reference', () => {
  it('401 when no session, DB untouched', async () => {
    mockRequire.mockRejectedValue(httpError(401))
    const res = await post(makeReq({ detectionId: 3 }), ctx('p1'))
    expect(res.status).toBe(401)
    expect(mockQuery).not.toHaveBeenCalled()
  })

  it('403 when member not active', async () => {
    mockRequire.mockRejectedValue(httpError(403, 'Active membership required'))
    const res = await post(makeReq({ detectionId: 3 }), ctx('p1'))
    expect(res.status).toBe(403)
  })

  it('400 when detectionId missing', async () => {
    const res = await post(makeReq({}), ctx('p1'))
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/detectionId required/)
    expect(mockQuery).not.toHaveBeenCalled()
  })

  it('404 when detection not found / not owned', async () => {
    mockQuery.mockResolvedValue([[]])
    const res = await post(makeReq({ detectionId: 3 }), ctx('p1'))
    expect(res.status).toBe(404)
    expect(res.body.error).toMatch(/not found or not yours/i)
    expect(mockAdd).not.toHaveBeenCalled()
  })

  it('happy path verifies detection then adds an event_crop reference', async () => {
    mockQuery.mockResolvedValue([
      [{ id: 3, face_bbox: '{}', blob_thumb_url: 'https://x/thumb.jpg' }],
    ])
    mockAdd.mockResolvedValue(42)

    const res = await post(makeReq({ detectionId: 3 }), ctx('p1'))
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ ok: true, data: { refId: 42 } })

    const [sql, params] = mockQuery.mock.calls[0]
    expect(sql).toMatch(/FROM photo_detections/)
    expect(params).toEqual([3, 'p1', MEMBER.memberId])

    expect(mockAdd).toHaveBeenCalledWith(MEMBER.memberId, 'https://x/thumb.jpg', {
      photoId: 'p1',
      detectionId: 3,
      source: 'event_crop',
    })
  })

  it('DB error → 500', async () => {
    mockQuery.mockRejectedValue(new Error('connect ETIMEDOUT'))
    const res = await post(makeReq({ detectionId: 3 }), ctx('p1'))
    expect(res.status).toBe(500)
    expect(res.body.error).toBe('Internal server error')
  })
})
