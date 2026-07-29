/**
 * Contract tests for POST/DELETE /api/events/[id]/rsvp
 *
 * The invariants that matter here:
 *  - a member can only RSVP as themselves (memberId comes from the session, and
 *    no body/query field can override it),
 *  - the write is an idempotent upsert, so a double-tapped button cannot create
 *    two rows, and
 *  - a bad event id becomes a 404, not an opaque 500 from the FK.
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
  requireSession: jest.fn(),
  getSession: jest.fn(),
}))
jest.mock('@/lib/db/connection', () => ({
  __esModule: true,
  default: { execute: jest.fn(), getConnection: jest.fn() },
  pool: { getConnection: jest.fn() },
  getDb: jest.fn(),
}))

import { POST, DELETE } from '@/app/api/events/[id]/rsvp/route'
import { requireActiveMember } from '@/lib/auth/session'
import db from '@/lib/db/connection'
import { todayNY, addDays } from '@/lib/events-range'

type Res = { status: number; body: any }
const post = POST as unknown as (req: unknown, ctx: unknown) => Promise<Res>
const del = DELETE as unknown as (req: unknown, ctx: unknown) => Promise<Res>
const mockRequireActive = requireActiveMember as jest.Mock
const mockExecute = db.execute as unknown as jest.Mock

const FUTURE = addDays(todayNY(), 30)

const ctx = (id: string) => ({ params: Promise.resolve({ id }) })
const req = (body: unknown) => ({ json: () => Promise.resolve(body) }) as any
const badJsonReq = () => ({ json: () => Promise.reject(new SyntaxError('bad')) }) as any

/** First execute() is the event-date lookup; second is the write. */
function mockEventExists(date: string | null = FUTURE) {
  mockExecute.mockReset()
  if (date === null) mockExecute.mockResolvedValueOnce([[]])
  else mockExecute.mockResolvedValueOnce([[{ event_date: date }]])
  mockExecute.mockResolvedValueOnce([{ affectedRows: 1 }])
}

beforeEach(() => {
  jest.clearAllMocks()
  mockRequireActive.mockResolvedValue({ memberId: 'A0042', status: 'active' })
  mockEventExists()
})

describe('POST rsvp — auth', () => {
  it('no session → 401, nothing written', async () => {
    mockExecute.mockReset()
    mockRequireActive.mockRejectedValue(Object.assign(new Error('Unauthorized'), { status: 401 }))
    const res = await post(req({ intent: 'running' }), ctx('320'))
    expect(res.status).toBe(401)
    expect(mockExecute).not.toHaveBeenCalled()
  })

  it('non-active member → 403, nothing written', async () => {
    mockExecute.mockReset()
    mockRequireActive.mockRejectedValue(
      Object.assign(new Error('Active membership required'), { status: 403 })
    )
    const res = await post(req({ intent: 'running' }), ctx('320'))
    expect(res.status).toBe(403)
    expect(mockExecute).not.toHaveBeenCalled()
  })
})

describe('POST rsvp — validation', () => {
  it.each(['abc', '0', '-1', '1.5'])('rejects event id %s with 400', async (id) => {
    mockExecute.mockReset()
    const res = await post(req({ intent: 'running' }), ctx(id))
    expect(res.status).toBe(400)
    expect(mockExecute).not.toHaveBeenCalled()
  })

  it('rejects an unknown intent', async () => {
    const res = await post(req({ intent: 'maybe' }), ctx('320'))
    expect(res.status).toBe(400)
  })

  it('rejects a missing intent', async () => {
    const res = await post(req({ note: 'hi' }), ctx('320'))
    expect(res.status).toBe(400)
  })

  it('rejects a note over the 280-char column limit', async () => {
    const res = await post(req({ intent: 'running', note: 'x'.repeat(281) }), ctx('320'))
    expect(res.status).toBe(400)
  })

  it('rejects a malformed JSON body with 400, not 500', async () => {
    const res = await post(badJsonReq(), ctx('320'))
    expect(res.status).toBe(400)
  })

  it('unknown event → 404 rather than an FK-driven 500', async () => {
    mockEventExists(null)
    const res = await post(req({ intent: 'running' }), ctx('99999'))
    expect(res.status).toBe(404)
    // Only the lookup ran; no insert was attempted.
    expect(mockExecute).toHaveBeenCalledTimes(1)
  })

  it('past race → 409 and no write', async () => {
    mockEventExists(addDays(todayNY(), -1))
    const res = await post(req({ intent: 'running' }), ctx('320'))
    expect(res.status).toBe(409)
    expect(mockExecute).toHaveBeenCalledTimes(1)
  })

  it('race day itself is still open', async () => {
    mockEventExists(todayNY())
    const res = await post(req({ intent: 'running' }), ctx('320'))
    expect(res.status).toBe(200)
  })
})

describe('POST rsvp — write behavior', () => {
  it('upserts with the session member, never a caller-supplied id', async () => {
    const res = await post(
      req({ intent: 'running', memberId: 'A0001', MemberID: 'A0001' }),
      ctx('320')
    )
    expect(res.status).toBe(200)

    const [sql, params] = mockExecute.mock.calls[1]
    expect(sql).toContain('ON DUPLICATE KEY UPDATE')
    expect(params[0]).toBe(320)
    expect(params[1]).toBe('A0042')
    expect(params).not.toContain('A0001')
  })

  it('passes the new values twice — no deprecated VALUES() in the UPDATE clause', async () => {
    await post(req({ intent: 'volunteering', note: 'water station' }), ctx('320'))
    const [sql, params] = mockExecute.mock.calls[1]
    expect(sql).not.toMatch(/VALUES\s*\(\s*intent/i)
    expect(params).toEqual([320, 'A0042', 'volunteering', 'water station', 'volunteering', 'water station'])
  })

  it('stores an omitted or blank note as NULL, not an empty string', async () => {
    await post(req({ intent: 'running' }), ctx('320'))
    expect(mockExecute.mock.calls[1][1][3]).toBeNull()

    mockEventExists()
    await post(req({ intent: 'running', note: '   ' }), ctx('320'))
    expect(mockExecute.mock.calls[1][1][3]).toBeNull()
  })

  it('is idempotent: the same POST twice issues the same upsert', async () => {
    const first = await post(req({ intent: 'running' }), ctx('320'))
    const firstCall = mockExecute.mock.calls[1]

    mockEventExists()
    const second = await post(req({ intent: 'running' }), ctx('320'))
    const secondCall = mockExecute.mock.calls[1]

    expect(first.status).toBe(200)
    expect(second.status).toBe(200)
    expect(secondCall[0]).toBe(firstCall[0])
    expect(secondCall[1]).toEqual(firstCall[1])
  })

  it('echoes the stored intent and note back to the client', async () => {
    const res = await post(req({ intent: 'interested', note: 'maybe' }), ctx('320'))
    expect(res.body.data).toEqual({ intent: 'interested', note: 'maybe' })
  })

  it.each(['running', 'volunteering', 'interested', 'not_going'])(
    'accepts the %s intent',
    async (intent) => {
      mockEventExists()
      const res = await post(req({ intent }), ctx('320'))
      expect(res.status).toBe(200)
    }
  )
})

describe('DELETE rsvp', () => {
  it('clears only the caller’s own row', async () => {
    mockExecute.mockReset()
    mockExecute.mockResolvedValueOnce([{ affectedRows: 1 }])
    const res = await del({} as any, ctx('320'))
    expect(res.status).toBe(200)
    expect(res.body.data.removed).toBe(true)

    const [sql, params] = mockExecute.mock.calls[0]
    expect(sql).toContain('DELETE FROM nyrr_event_rsvps')
    expect(sql).toContain('MemberID = ?')
    expect(params).toEqual([320, 'A0042'])
  })

  it('clearing a non-existent RSVP is a success, not a 404', async () => {
    // The caller's intended end state ("no RSVP") is already true.
    mockExecute.mockReset()
    mockExecute.mockResolvedValueOnce([{ affectedRows: 0 }])
    const res = await del({} as any, ctx('320'))
    expect(res.status).toBe(200)
    expect(res.body.data.removed).toBe(false)
  })

  it('no session → 401, nothing deleted', async () => {
    mockExecute.mockReset()
    mockRequireActive.mockRejectedValue(Object.assign(new Error('Unauthorized'), { status: 401 }))
    const res = await del({} as any, ctx('320'))
    expect(res.status).toBe(401)
    expect(mockExecute).not.toHaveBeenCalled()
  })

  it('rejects a bad event id', async () => {
    mockExecute.mockReset()
    const res = await del({} as any, ctx('nope'))
    expect(res.status).toBe(400)
    expect(mockExecute).not.toHaveBeenCalled()
  })
})
