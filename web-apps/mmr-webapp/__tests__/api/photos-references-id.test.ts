/**
 * Contract tests for DELETE /api/photos/references/[id]
 *
 * Mocks the session guard and removeReferencePhoto. Verifies auth
 * (401/403), id validation (400), the scoped soft-delete call, and the
 * DB error path.
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
jest.mock('@/lib/db/photos', () => ({ removeReferencePhoto: jest.fn() }))

import { DELETE } from '@/app/api/photos/references/[id]/route'
import { requireActiveMember } from '@/lib/auth/session'
import { removeReferencePhoto } from '@/lib/db/photos'

const del = DELETE as unknown as (
  req: unknown,
  ctx: { params: { id: string } }
) => Promise<{ status: number; body: any }>
const mockRequire = requireActiveMember as jest.Mock
const mockRemove = removeReferencePhoto as jest.Mock

const MEMBER = { memberId: 'MMR-2026-0001', email: 'a@example.com', status: 'active' }

function httpError(status: number, message = 'x'): Error {
  const err: any = new Error(message)
  err.status = status
  return err
}
const ctx = (id: string) => ({ params: { id } })

beforeEach(() => {
  jest.clearAllMocks()
  mockRequire.mockResolvedValue(MEMBER)
  mockRemove.mockResolvedValue(undefined)
})

describe('DELETE /api/photos/references/[id]', () => {
  it('401 when no session, DB untouched', async () => {
    mockRequire.mockRejectedValue(httpError(401))
    const res = await del({}, ctx('5'))
    expect(res.status).toBe(401)
    expect(mockRemove).not.toHaveBeenCalled()
  })

  it('403 when member not active', async () => {
    mockRequire.mockRejectedValue(httpError(403, 'Active membership required'))
    const res = await del({}, ctx('5'))
    expect(res.status).toBe(403)
  })

  it.each(['0', '-3', 'abc'])('400 for invalid id "%s"', async (id) => {
    const res = await del({}, ctx(id))
    expect(res.status).toBe(400)
    expect(res.body.error).toBe('Invalid id')
    expect(mockRemove).not.toHaveBeenCalled()
  })

  it('happy path soft-deletes the member-owned ref', async () => {
    const res = await del({}, ctx('7'))
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ ok: true })
    expect(mockRemove).toHaveBeenCalledWith(MEMBER.memberId, 7)
  })

  it('DB error → 500', async () => {
    mockRemove.mockRejectedValue(new Error('boom'))
    const res = await del({}, ctx('7'))
    expect(res.status).toBe(500)
  })
})
