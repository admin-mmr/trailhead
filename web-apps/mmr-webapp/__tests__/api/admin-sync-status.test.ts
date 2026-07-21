/**
 * Contract tests for GET /api/admin/sync-status — Sheets→MySQL sync status.
 * Guard: requireActiveMember() then session.memberId presence.
 * NOTE: the route's catch block maps ALL thrown errors (incl. an auth throw
 * from requireActiveMember) to a generic 500 — there is no 401 path here.
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

jest.mock('@/lib/db/connection', () => ({
  __esModule: true,
  default: { execute: jest.fn() },
  pool: { getConnection: jest.fn() },
  getDb: jest.fn(),
}))

import { GET } from '@/app/api/admin/sync-status/route'
import { requireActiveMember } from '@/lib/auth/session'
import db from '@/lib/db/connection'

type Res = { status: number; body: any }
const get = GET as unknown as (req: unknown) => Promise<Res>
const execute = (db as any).execute as jest.Mock

const makeReq = (qs = '') =>
  ({ nextUrl: { searchParams: new URLSearchParams(qs) } } as any)

const member = { memberId: 'MMR-2026-0001', email: 'a@b.com', status: 'active' }

beforeEach(() => {
  jest.clearAllMocks()
  ;(requireActiveMember as jest.Mock).mockResolvedValue(member)
  execute.mockResolvedValue([[], []])
})

describe('GET /api/admin/sync-status', () => {
  it('403 when the session has no memberId', async () => {
    ;(requireActiveMember as jest.Mock).mockResolvedValue({ email: 'a@b.com' })
    expect((await get(makeReq())).status).toBe(403)
  })

  it('200 with default shape when tables are empty', async () => {
    const res = await get(makeReq())
    expect(res.status).toBe(200)
    expect(res.body).toEqual({
      metadata: null,
      snapshots: [],
      recent_changes: [],
      unresolved_conflicts: [],
      stats: {},
    })
  })

  it('passes the sheet + limit query params into the snapshot query', async () => {
    await get(makeReq('sheet=Roster&limit=5'))
    const snapshotCall = execute.mock.calls.find(([sql]) => /FROM sync_snapshots/.test(sql))
    expect(snapshotCall).toBeDefined()
    expect(snapshotCall![1]).toEqual(['Roster', 5])
  })

  it('returns metadata + stats rows when present', async () => {
    execute
      .mockResolvedValueOnce([[{ sheet_name: 'Membership Master', last_sync: 't' }], []]) // metadata
      .mockResolvedValueOnce([[{ snapshot_id: 1 }], []]) // snapshots
      .mockResolvedValueOnce([[], []]) // changes
      .mockResolvedValueOnce([[], []]) // conflicts
      .mockResolvedValueOnce([[{ total_snapshots: 3 }], []]) // stats
    const res = await get(makeReq())
    expect(res.body.metadata).toEqual({ sheet_name: 'Membership Master', last_sync: 't' })
    expect(res.body.stats).toEqual({ total_snapshots: 3 })
  })

  it('500 on DB error', async () => {
    execute.mockRejectedValue(new Error('db down'))
    expect((await get(makeReq())).status).toBe(500)
  })
})
