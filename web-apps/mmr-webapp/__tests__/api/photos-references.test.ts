/**
 * Contract tests for GET /api/photos/references
 *
 * Mocks the session guard and getMemberReferencePhotos. Verifies auth
 * (401/403), the happy-path reference list, and the DB error path.
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
jest.mock('@/lib/db/photos', () => ({ getMemberReferencePhotos: jest.fn() }))

import { GET } from '@/app/api/photos/references/route'
import { requireActiveMember } from '@/lib/auth/session'
import { getMemberReferencePhotos } from '@/lib/db/photos'

const get = GET as unknown as () => Promise<{ status: number; body: any }>
const mockRequire = requireActiveMember as jest.Mock
const mockGet = getMemberReferencePhotos as jest.Mock

const MEMBER = { memberId: 'MMR-2026-0001', email: 'a@example.com', status: 'active' }

function httpError(status: number, message = 'x'): Error {
  const err: any = new Error(message)
  err.status = status
  return err
}

beforeEach(() => {
  jest.clearAllMocks()
  mockRequire.mockResolvedValue(MEMBER)
  mockGet.mockResolvedValue([])
})

describe('GET /api/photos/references', () => {
  it('401 when no session, DB untouched', async () => {
    mockRequire.mockRejectedValue(httpError(401))
    const res = await get()
    expect(res.status).toBe(401)
    expect(mockGet).not.toHaveBeenCalled()
  })

  it('403 when member not active', async () => {
    mockRequire.mockRejectedValue(httpError(403, 'Active membership required'))
    const res = await get()
    expect(res.status).toBe(403)
  })

  it('happy path returns member reference photos', async () => {
    const refs = [{ id: 1, isFresh: true }, { id: 2, isFresh: false }]
    mockGet.mockResolvedValue(refs)
    const res = await get()
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ ok: true, data: refs })
    expect(mockGet).toHaveBeenCalledWith(MEMBER.memberId)
  })

  it('DB error → 500', async () => {
    mockGet.mockRejectedValue(new Error('boom'))
    const res = await get()
    expect(res.status).toBe(500)
  })
})
