/**
 * Contract tests for POST /api/notifications/family-updated.
 *
 * Called by the Flask admin after a family regrouping. It is secret-gated rather
 * than session-gated on purpose: a member naming an arbitrary familyId would
 * learn how many people are in someone else's household.
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
jest.mock('@/lib/notifications/family', () => ({
  notifyFamilyRosterChange: jest.fn(),
}))

import { POST } from '@/app/api/notifications/family-updated/route'
import { notifyFamilyRosterChange } from '@/lib/notifications/family'

const mockNotify = notifyFamilyRosterChange as jest.Mock
type Res = { status: number; body: any }
const post = POST as unknown as (req: unknown) => Promise<Res>

const SECRET = 'family-hook-secret'

function request(body: unknown, token: string | null = SECRET, badJson = false) {
  return {
    headers: {
      get: (k: string) =>
        k.toLowerCase() === 'authorization' && token ? `Bearer ${token}` : null,
    },
    json: async () => {
      if (badJson) throw new SyntaxError('Unexpected token')
      return body
    },
  }
}

beforeEach(() => {
  jest.clearAllMocks()
  process.env.JOB_SECRET = SECRET
  mockNotify.mockResolvedValue({ recipients: 3, sent: 3, skipped: 0, failed: 0, errors: [] })
})

afterAll(() => { delete process.env.JOB_SECRET })

it('notifies the family and returns the counts', async () => {
  const res = await post(request({ familyId: 'B001', addedMemberIds: ['A0003'] }))

  expect(res.status).toBe(200)
  expect(res.body.data.sent).toBe(3)
  expect(mockNotify).toHaveBeenCalledWith({
    familyId: 'B001',
    addedMemberIds: ['A0003'],
  })
})

it('passes a dedupeSuffix through so a double-clicked admin action mails once', async () => {
  await post(request({
    familyId: 'B001', addedMemberIds: ['A0003'], dedupeSuffix: 'add-A0003-20260730',
  }))

  expect(mockNotify).toHaveBeenCalledWith(
    expect.objectContaining({ dedupeSuffix: 'add-A0003-20260730' }),
  )
})

it('401s without the shared secret, and notifies nobody', async () => {
  const res = await post(request({ familyId: 'B001' }, null))

  expect(res.status).toBe(401)
  expect(mockNotify).not.toHaveBeenCalled()
})

it('400s a missing familyId', async () => {
  const res = await post(request({ addedMemberIds: ['A0003'] }))

  expect(res.status).toBe(400)
  expect(res.body.error).toMatch(/familyId/)
  expect(mockNotify).not.toHaveBeenCalled()
})

it('400s a blank familyId — whitespace is not an id', async () => {
  const res = await post(request({ familyId: '   ' }))

  expect(res.status).toBe(400)
  expect(mockNotify).not.toHaveBeenCalled()
})

it('400s malformed JSON instead of throwing', async () => {
  const res = await post(request(null, SECRET, true))

  expect(res.status).toBe(400)
  expect(res.body.error).toMatch(/JSON/)
})

it('400s addedMemberIds that is not an array', async () => {
  const res = await post(request({ familyId: 'B001', addedMemberIds: 'A0003' }))

  expect(res.status).toBe(400)
  expect(res.body.error).toMatch(/array/)
})

it('tolerates an omitted addedMemberIds — a roster can change without an add', async () => {
  const res = await post(request({ familyId: 'B001' }))

  expect(res.status).toBe(200)
  expect(mockNotify).toHaveBeenCalledWith({ familyId: 'B001', addedMemberIds: [] })
})

it('drops non-string entries rather than passing them to the query', async () => {
  await post(request({ familyId: 'B001', addedMemberIds: ['A0003', 42, null, '  '] }))

  expect(mockNotify).toHaveBeenCalledWith(
    expect.objectContaining({ addedMemberIds: ['A0003'] }),
  )
})

it('404s when the familyId matched nobody — a caller bug, not a silent success', async () => {
  mockNotify.mockResolvedValue({ recipients: 0, sent: 0, skipped: 0, failed: 0, errors: [] })

  const res = await post(request({ familyId: 'NOPE' }))

  expect(res.status).toBe(404)
  expect(res.body.error).toMatch(/NOPE/)
})

it('500s when the fan-out itself throws', async () => {
  mockNotify.mockRejectedValue(new Error('pool exhausted'))

  const res = await post(request({ familyId: 'B001' }))

  expect(res.status).toBe(500)
  expect(res.body.error).toBe('pool exhausted')
})
