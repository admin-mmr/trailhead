/**
 * Contract tests for POST /api/photos/detections/[id]/correction
 *
 * Mocks the session guard and submitCorrection. Verifies auth (401/403),
 * correctionType validation (400), that id is coerced to a number and all
 * fields reach the helper, and the DB error path.
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
jest.mock('@/lib/db/photos', () => ({ submitCorrection: jest.fn() }))

import { POST } from '@/app/api/photos/detections/[id]/correction/route'
import { requireActiveMember } from '@/lib/auth/session'
import { submitCorrection } from '@/lib/db/photos'

const post = POST as unknown as (
  req: unknown,
  ctx: { params: { id: string } }
) => Promise<{ status: number; body: any }>
const mockRequire = requireActiveMember as jest.Mock
const mockSubmit = submitCorrection as jest.Mock

const MEMBER = { memberId: 'MMR-2026-0001', email: 'a@example.com', status: 'active' }

function httpError(status: number, message = 'x'): Error {
  const err: any = new Error(message)
  err.status = status
  return err
}
const makeReq = (body?: unknown) => ({ json: async () => body }) as any
const ctx = (id: string) => ({ params: { id } })

beforeEach(() => {
  jest.clearAllMocks()
  mockRequire.mockResolvedValue(MEMBER)
  mockSubmit.mockResolvedValue(undefined)
})

describe('POST /api/photos/detections/[id]/correction', () => {
  it('401 when no session, DB untouched', async () => {
    mockRequire.mockRejectedValue(httpError(401))
    const res = await post(makeReq({ correctionType: 'wrong_person' }), ctx('5'))
    expect(res.status).toBe(401)
    expect(mockSubmit).not.toHaveBeenCalled()
  })

  it('403 when member not active', async () => {
    mockRequire.mockRejectedValue(httpError(403, 'Active membership required'))
    const res = await post(makeReq({ correctionType: 'wrong_person' }), ctx('5'))
    expect(res.status).toBe(403)
  })

  it.each(['nope', '', undefined, 'WRONG_PERSON'])(
    '400 for invalid correctionType %p',
    async (correctionType) => {
      const res = await post(makeReq({ correctionType }), ctx('5'))
      expect(res.status).toBe(400)
      expect(res.body.error).toBe('Invalid correctionType')
      expect(mockSubmit).not.toHaveBeenCalled()
    }
  )

  it('happy path coerces id to number and forwards all fields', async () => {
    const res = await post(
      makeReq({
        correctionType: 'correct_person',
        suggestedMemberId: 'A0042',
        note: 'this is Amy',
      }),
      ctx('5')
    )
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ ok: true })
    expect(mockSubmit).toHaveBeenCalledWith(
      5,
      MEMBER.memberId,
      'correct_person',
      'A0042',
      'this is Amy'
    )
  })

  it.each(['wrong_person', 'correct_person', 'missing_person'])(
    'accepts valid correctionType %s',
    async (correctionType) => {
      const res = await post(makeReq({ correctionType }), ctx('9'))
      expect(res.status).toBe(200)
    }
  )

  it('DB error → 500', async () => {
    mockSubmit.mockRejectedValue(new Error('boom'))
    const res = await post(makeReq({ correctionType: 'missing_person' }), ctx('5'))
    expect(res.status).toBe(500)
  })
})
