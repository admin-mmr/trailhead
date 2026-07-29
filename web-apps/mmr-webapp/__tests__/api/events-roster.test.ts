/**
 * Contract tests for GET /api/events/[id]/roster
 *
 * The privacy contract is the whole point of this route: a member with
 * ShowRsvpPublicly = 0 must be COUNTED but never NAMED. These tests assert that
 * from the outside — the opted-out member's name and id must not appear anywhere
 * in the serialized response, while the totals still include them.
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

import { GET } from '@/app/api/events/[id]/roster/route'
import { requireActiveMember } from '@/lib/auth/session'
import db from '@/lib/db/connection'

type Res = { status: number; body: any }
const get = GET as unknown as (req: unknown, ctx: unknown) => Promise<Res>
const mockRequireActive = requireActiveMember as jest.Mock
const mockExecute = db.execute as unknown as jest.Mock

const ctx = (id: string) => ({ params: Promise.resolve({ id }) })

const rsvpRow = (over: Record<string, unknown> = {}) => ({
  MemberID: 'A0042',
  intent: 'running',
  note: null,
  FirstName: 'Mei',
  LastName: 'Chen',
  ShowRsvpPublicly: 1,
  ...over,
})

/** First execute() is the event-existence lookup; second returns roster rows. */
function mockRoster(rows: Record<string, unknown>[], eventDate = '2026-08-05') {
  mockExecute.mockReset()
  mockExecute.mockResolvedValueOnce([[{ event_date: eventDate }]]).mockResolvedValueOnce([rows])
}

beforeEach(() => {
  jest.clearAllMocks()
  mockRequireActive.mockResolvedValue({ memberId: 'A0001', status: 'active' })
  mockRoster([rsvpRow()])
})

describe('GET roster — auth', () => {
  it('no session → 401, DB untouched', async () => {
    mockExecute.mockReset()
    mockRequireActive.mockRejectedValue(Object.assign(new Error('Unauthorized'), { status: 401 }))
    const res = await get({} as any, ctx('320'))
    expect(res.status).toBe(401)
    expect(mockExecute).not.toHaveBeenCalled()
  })

  it('non-active member → 403', async () => {
    mockExecute.mockReset()
    mockRequireActive.mockRejectedValue(
      Object.assign(new Error('Active membership required'), { status: 403 })
    )
    const res = await get({} as any, ctx('320'))
    expect(res.status).toBe(403)
  })

  it('bad event id → 400, DB untouched', async () => {
    mockExecute.mockReset()
    const res = await get({} as any, ctx('abc'))
    expect(res.status).toBe(400)
    expect(mockExecute).not.toHaveBeenCalled()
  })

  it('unknown event → 404', async () => {
    mockExecute.mockReset()
    mockExecute.mockResolvedValueOnce([[]])
    const res = await get({} as any, ctx('99999'))
    expect(res.status).toBe(404)
  })
})

describe('GET roster — privacy contract', () => {
  it('counts an opted-out member but never names them', async () => {
    mockRoster([
      rsvpRow({ MemberID: 'A0042', FirstName: 'Mei', LastName: 'Chen', ShowRsvpPublicly: 1 }),
      rsvpRow({ MemberID: 'A0099', FirstName: 'Shy', LastName: 'Runner', ShowRsvpPublicly: 0 }),
    ])

    const res = await get({} as any, ctx('320'))
    const { data } = res.body

    expect(data.counts.running).toBe(2)
    expect(data.running.map((e: any) => e.name)).toEqual(['Mei Chen'])
    expect(data.hiddenCount).toBe(1)

    // Nothing identifying the opted-out member may appear anywhere.
    const serialized = JSON.stringify(res.body)
    expect(serialized).not.toContain('Shy')
    expect(serialized).not.toContain('Runner')
    expect(serialized).not.toContain('A0099')
  })

  it('hides an opted-out member’s note as well as their name', async () => {
    mockRoster([
      rsvpRow({ MemberID: 'A0099', ShowRsvpPublicly: 0, note: 'meeting my cousin at mile 8' }),
    ])
    const res = await get({} as any, ctx('320'))
    expect(JSON.stringify(res.body)).not.toContain('cousin')
    expect(res.body.data.hiddenCount).toBe(1)
  })

  it('counts not_going but never lists it in any name bucket', async () => {
    mockRoster([rsvpRow({ intent: 'not_going', FirstName: 'Busy', LastName: 'Person' })])
    const res = await get({} as any, ctx('320'))
    const { data } = res.body

    expect(data.counts.notGoing).toBe(1)
    expect(data.running).toEqual([])
    expect(data.volunteering).toEqual([])
    expect(data.interested).toEqual([])
    expect(JSON.stringify(res.body)).not.toContain('Busy')
  })

  it('does not count a not_going opt-out toward hiddenCount', async () => {
    // hiddenCount describes attendees who are unnamed, not absentees.
    mockRoster([rsvpRow({ intent: 'not_going', ShowRsvpPublicly: 0 })])
    const res = await get({} as any, ctx('320'))
    expect(res.body.data.hiddenCount).toBe(0)
    expect(res.body.data.counts.notGoing).toBe(1)
  })

  it('never falls back to an email address for a missing name', async () => {
    mockRoster([rsvpRow({ FirstName: null, LastName: null, MemberID: 'A0077' })])
    const res = await get({} as any, ctx('320'))
    expect(res.body.data.running[0].name).toBe('A0077')
    expect(JSON.stringify(res.body)).not.toContain('@')
  })
})

describe('GET roster — grouping', () => {
  it('splits members across intents with matching counts', async () => {
    mockRoster([
      rsvpRow({ MemberID: 'A1', intent: 'running', FirstName: 'A', LastName: 'One' }),
      rsvpRow({ MemberID: 'A2', intent: 'running', FirstName: 'B', LastName: 'Two' }),
      rsvpRow({ MemberID: 'A3', intent: 'volunteering', FirstName: 'C', LastName: 'Three' }),
      rsvpRow({ MemberID: 'A4', intent: 'interested', FirstName: 'D', LastName: 'Four' }),
      rsvpRow({ MemberID: 'A5', intent: 'not_going', FirstName: 'E', LastName: 'Five' }),
    ])

    const { data } = (await get({} as any, ctx('320'))).body
    expect(data.counts).toEqual({ running: 2, volunteering: 1, interested: 1, notGoing: 1 })
    expect(data.running).toHaveLength(2)
    expect(data.volunteering[0].name).toBe('C Three')
    expect(data.interested[0].name).toBe('D Four')
  })

  it('carries a visible member’s note through', async () => {
    mockRoster([rsvpRow({ note: 'pacing the 3:30 group' })])
    const { data } = (await get({} as any, ctx('320'))).body
    expect(data.running[0].note).toBe('pacing the 3:30 group')
  })

  it('returns empty buckets and zero counts for an event nobody answered', async () => {
    mockRoster([])
    const { data } = (await get({} as any, ctx('320'))).body
    expect(data.running).toEqual([])
    expect(data.hiddenCount).toBe(0)
    expect(data.counts).toEqual({ running: 0, volunteering: 0, interested: 0, notGoing: 0 })
  })

  it('scopes the query to the requested event', async () => {
    await get({} as any, ctx('320'))
    const [sql, params] = mockExecute.mock.calls[1]
    expect(sql).toContain('WHERE r.nyrr_event_id = ?')
    expect(params).toEqual([320])
  })

  it('DB failure → 500 with no internals leaked', async () => {
    mockExecute.mockReset()
    mockExecute.mockRejectedValue(new Error('ER_BAD_FIELD_ERROR: ShowRsvpPublicly'))
    const res = await get({} as any, ctx('320'))
    expect(res.status).toBe(500)
    expect(JSON.stringify(res.body)).not.toContain('ShowRsvpPublicly')
  })
})
