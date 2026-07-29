/**
 * Contract tests for GET /api/events/calendar
 *
 * Active-member route: requireActiveMember() throws 401 (no session) or 403
 * (logged in but not active). The roster counts are member data, so an
 * unauthenticated caller must never reach the DB.
 *
 * Also pins the two things most likely to regress silently:
 *  - the query is scoped to the *session* member (member A must not see member
 *    B's intent), and
 *  - event_date arrives as a 'YYYY-MM-DD' string, never a Date, because a Date
 *    JSON-serializes to a UTC instant and renders a day early west of Greenwich.
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

import { GET } from '@/app/api/events/calendar/route'
import { requireActiveMember } from '@/lib/auth/session'
import db from '@/lib/db/connection'
import { MAX_RANGE_DAYS, addMonths, daysBetween, todayNY } from '@/lib/events-range'

const get = GET as unknown as (req: unknown) => Promise<{ status: number; body: any }>
const mockRequireActive = requireActiveMember as jest.Mock
const mockExecute = db.execute as unknown as jest.Mock

const makeReq = (query = '') =>
  ({
    url: `http://x/api/events/calendar${query}`,
    nextUrl: { searchParams: new URLSearchParams(query.replace(/^\?/, '')) },
  }) as any

/** One raw DB row as mysql2 would hand it back (DECIMAL as string, tinyint as number). */
const rawRow = (over: Record<string, unknown> = {}) => ({
  id: 87,
  event_code: 'tcs-new-york-city-marathon',
  event_name: '2026 TCS New York City Marathon',
  event_date: '2026-11-01',
  location: 'New York City',
  distance: 'Marathon',
  distance_km: '42.195',
  is_virtual: 0,
  event_url: 'https://www.nyrr.org/races/marathon',
  my_intent: null,
  my_note: null,
  running_count: 3,
  volunteering_count: 1,
  interested_count: 0,
  ...over,
})

beforeEach(() => {
  jest.clearAllMocks()
  mockRequireActive.mockResolvedValue({ memberId: 'A0042', status: 'active' })
  // Default: [events query, latest-known-date query]
  mockExecute.mockResolvedValueOnce([[rawRow()]]).mockResolvedValueOnce([[{ latest: '2026-11-01' }]])
})

describe('GET /api/events/calendar — auth', () => {
  it('no session → 401 and the DB is never touched', async () => {
    mockExecute.mockReset()
    mockRequireActive.mockRejectedValue(Object.assign(new Error('Unauthorized'), { status: 401 }))
    const res = await get(makeReq())
    expect(res.status).toBe(401)
    expect(mockExecute).not.toHaveBeenCalled()
  })

  it('logged in but not active → 403 and the DB is never touched', async () => {
    mockExecute.mockReset()
    mockRequireActive.mockRejectedValue(
      Object.assign(new Error('Active membership required'), { status: 403 })
    )
    const res = await get(makeReq())
    expect(res.status).toBe(403)
    expect(mockExecute).not.toHaveBeenCalled()
  })
})

describe('GET /api/events/calendar — scoping', () => {
  it('scopes the RSVP join to the session member, not a query param', async () => {
    // The attack this blocks: ?memberId=A0001 to read someone else's intent.
    await get(makeReq('?memberId=A0001'))
    const [, params] = mockExecute.mock.calls[0]
    expect(params[0]).toBe('A0042')
    expect(params).not.toContain('A0001')
  })

  it('passes the resolved range as the 2nd and 3rd bound parameters', async () => {
    await get(makeReq('?from=2026-08-01&to=2026-09-30'))
    const [sql, params] = mockExecute.mock.calls[0]
    expect(params).toEqual(['A0042', '2026-08-01', '2026-09-30'])
    // Bounds must be parameterized, not interpolated.
    expect(sql).toContain('BETWEEN ? AND ?')
    expect(sql).not.toContain('2026-08-01')
  })
})

describe('GET /api/events/calendar — range handling', () => {
  it('defaults to one month back → three months forward', async () => {
    const today = todayNY()
    const res = await get(makeReq())
    expect(res.status).toBe(200)
    expect(res.body.data.from).toBe(addMonths(today, -1))
    expect(res.body.data.to).toBe(addMonths(today, 3))
    expect(res.body.data.clamped).toBe(false)
  })

  it('clamps an oversized span and flags it in the response', async () => {
    const res = await get(makeReq('?from=2020-01-01&to=2030-01-01'))
    expect(res.status).toBe(200)
    expect(res.body.data.clamped).toBe(true)
    expect(daysBetween(res.body.data.from, res.body.data.to)).toBe(MAX_RANGE_DAYS)
  })

  it('from later than to → 400, DB untouched', async () => {
    mockExecute.mockReset()
    const res = await get(makeReq('?from=2026-09-01&to=2026-08-01'))
    expect(res.status).toBe(400)
    expect(mockExecute).not.toHaveBeenCalled()
  })

  it('malformed dates fall back to the default window instead of hitting SQL', async () => {
    const res = await get(makeReq('?from=2026-02-31&to=lol'))
    expect(res.status).toBe(200)
    const [, params] = mockExecute.mock.calls[0]
    expect(params[1]).toBe(addMonths(todayNY(), -1))
    expect(params[2]).toBe(addMonths(todayNY(), 3))
  })
})

describe('GET /api/events/calendar — payload shape', () => {
  it('maps a row to camelCase with typed scalars', async () => {
    const res = await get(makeReq())
    expect(res.body.ok).toBe(true)
    expect(res.body.data.events).toHaveLength(1)

    const event = res.body.data.events[0]
    expect(event).toMatchObject({
      id: 87,
      eventCode: 'tcs-new-york-city-marathon',
      eventName: '2026 TCS New York City Marathon',
      eventDate: '2026-11-01',
      location: 'New York City',
      distance: 'Marathon',
      isVirtual: false,
      myIntent: null,
    })
    // DECIMAL arrives as a string from mysql2 — must be a number on the wire.
    expect(event.distanceKm).toBe(42.195)
    expect(typeof event.distanceKm).toBe('number')
    expect(event.runningCount).toBe(3)
    expect(event.volunteeringCount).toBe(1)
  })

  it('formats event_date in SQL so no Date object can reach the client', async () => {
    const [sql] = (await get(makeReq()), mockExecute.mock.calls[0])
    expect(sql).toContain("DATE_FORMAT(e.event_date, '%Y-%m-%d')")
  })

  it('surfaces the caller’s own intent and note', async () => {
    mockExecute.mockReset()
    mockExecute
      .mockResolvedValueOnce([[rawRow({ my_intent: 'volunteering', my_note: 'water station' })]])
      .mockResolvedValueOnce([[{ latest: '2026-11-01' }]])
    const res = await get(makeReq())
    expect(res.body.data.events[0].myIntent).toBe('volunteering')
    expect(res.body.data.events[0].myNote).toBe('water station')
  })

  it('coerces a NULL distance pair to null rather than 0 or NaN', async () => {
    mockExecute.mockReset()
    mockExecute
      .mockResolvedValueOnce([[rawRow({ distance: null, distance_km: null })]])
      .mockResolvedValueOnce([[{ latest: '2026-11-01' }]])
    const res = await get(makeReq())
    expect(res.body.data.events[0].distance).toBeNull()
    expect(res.body.data.events[0].distanceKm).toBeNull()
  })

  it('returns an empty list plus latestKnownEventDate when the window has no races', async () => {
    // The expected steady state: NYRR publishes ~8 weeks out, so far-future
    // windows are legitimately empty and the UI explains that with this field.
    mockExecute.mockReset()
    mockExecute
      .mockResolvedValueOnce([[]])
      .mockResolvedValueOnce([[{ latest: '2026-11-01' }]])
    const res = await get(makeReq('?from=2027-01-01&to=2027-03-01'))
    expect(res.status).toBe(200)
    expect(res.body.data.events).toEqual([])
    expect(res.body.data.latestKnownEventDate).toBe('2026-11-01')
  })

  it('tolerates an empty events table (no latest date at all)', async () => {
    mockExecute.mockReset()
    mockExecute.mockResolvedValueOnce([[]]).mockResolvedValueOnce([[{ latest: null }]])
    const res = await get(makeReq())
    expect(res.status).toBe(200)
    expect(res.body.data.latestKnownEventDate).toBeNull()
  })

  it('DB failure → 500 with no internals leaked', async () => {
    mockExecute.mockReset()
    mockExecute.mockRejectedValue(new Error('ER_NO_SUCH_TABLE: nyrr_event_rsvps'))
    const res = await get(makeReq())
    expect(res.status).toBe(500)
    expect(res.body.error).toBe('Internal server error')
    expect(JSON.stringify(res.body)).not.toContain('ER_NO_SUCH_TABLE')
  })
})
