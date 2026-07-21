/**
 * Contract tests for GET /api/photos/albums
 *
 * Mocks the session guard and getAllPhotoEvents. Verifies auth (401/403),
 * the happy-path event list, and the DB error path.
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
jest.mock('@/lib/db/photos', () => ({ getAllPhotoEvents: jest.fn() }))

import { GET } from '@/app/api/photos/albums/route'
import { requireActiveMember } from '@/lib/auth/session'
import { getAllPhotoEvents } from '@/lib/db/photos'

const get = GET as unknown as () => Promise<{ status: number; body: any }>
const mockRequire = requireActiveMember as jest.Mock
const mockGet = getAllPhotoEvents as jest.Mock

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

describe('GET /api/photos/albums', () => {
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

  it('happy path returns event list', async () => {
    const events = [{ eventId: 'E1' }, { eventId: 'E2' }]
    mockGet.mockResolvedValue(events)
    const res = await get()
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ ok: true, data: events })
    expect(mockGet).toHaveBeenCalledTimes(1)
  })

  it('DB error → 500', async () => {
    mockGet.mockRejectedValue(new Error('boom'))
    const res = await get()
    expect(res.status).toBe(500)
  })
})
