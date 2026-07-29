/**
 * Contract tests for PATCH /api/nyrr/members/[id]/edit-name
 *
 * Admin-only, transactional. Plain params { id }. Body { nyrrRunnerName }.
 * Updates member name; when a non-empty name is given, backfills matching
 * runners and recomputes event counts. The connection is acquired after auth +
 * validation and released in a finally.
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
  requireSession: jest.fn(),
  getSession: jest.fn(),
  requireActiveMember: jest.fn(),
}))
jest.mock('@/lib/db/admins', () => ({ isAdmin: jest.fn() }))
jest.mock('@/lib/db/connection', () => ({
  __esModule: true,
  default: { execute: jest.fn(), getConnection: jest.fn() },
  pool: { getConnection: jest.fn() },
  getDb: jest.fn(),
}))

import { PATCH } from '@/app/api/nyrr/members/[id]/edit-name/route'
import { requireSession } from '@/lib/auth/session'
import { isAdmin } from '@/lib/db/admins'
import db from '@/lib/db/connection'

const patch = PATCH as unknown as (req: unknown, ctx: any) => Promise<{ status: number; body: any }>
const mockRequireSession = requireSession as jest.Mock
const mockIsAdmin = isAdmin as jest.Mock
const mockGetConnection = db.getConnection as unknown as jest.Mock

const makeReq = (body: any) => ({ json: async () => body } as any)
const ctx = (id: string) => ({ params: { id } })

let conn: {
  execute: jest.Mock
  beginTransaction: jest.Mock
  commit: jest.Mock
  rollback: jest.Mock
  release: jest.Mock
}

beforeEach(() => {
  jest.clearAllMocks()
  mockRequireSession.mockResolvedValue({ email: 'admin@mmr.org' })
  mockIsAdmin.mockResolvedValue(true)
  conn = {
    execute: jest.fn().mockResolvedValue([[]]),
    beginTransaction: jest.fn(),
    commit: jest.fn(),
    rollback: jest.fn(),
    release: jest.fn(),
  }
  mockGetConnection.mockResolvedValue(conn)
})

describe('PATCH /api/nyrr/members/[id]/edit-name — auth & validation', () => {
  it('no session → 401, no connection acquired', async () => {
    mockRequireSession.mockRejectedValue(Object.assign(new Error('Unauthorized'), { status: 401 }))
    const res = await patch(makeReq({ nyrrRunnerName: 'Amy Zed' }), ctx('A0001'))
    expect(res.status).toBe(401)
    expect(mockGetConnection).not.toHaveBeenCalled()
    expect(conn.beginTransaction).not.toHaveBeenCalled()
  })

  it('non-admin → 403, no connection acquired', async () => {
    mockIsAdmin.mockResolvedValue(false)
    const res = await patch(makeReq({ nyrrRunnerName: 'Amy Zed' }), ctx('A0001'))
    expect(res.status).toBe(403)
    expect(mockGetConnection).not.toHaveBeenCalled()
  })

  it('missing nyrrRunnerName → 400, no connection acquired', async () => {
    const res = await patch(makeReq({}), ctx('A0001'))
    expect(res.status).toBe(400)
    expect(res.body.error).toBe('nyrrRunnerName is required')
    expect(mockGetConnection).not.toHaveBeenCalled()
    expect(conn.beginTransaction).not.toHaveBeenCalled()
  })
})

describe('PATCH /api/nyrr/members/[id]/edit-name — happy path', () => {
  it('updates name, backfills runners, recomputes counts, commits', async () => {
    conn.execute
      .mockResolvedValueOnce([[]]) // UPDATE members name
      .mockResolvedValueOnce([[{ nyrr_event_id: 5 }]]) // SELECT DISTINCT affected
      .mockResolvedValueOnce([[]]) // UPDATE backfill runners
      .mockResolvedValueOnce([[{ count: 4 }]]) // SELECT COUNT
      .mockResolvedValueOnce([[]]) // UPDATE event count

    const res = await patch(makeReq({ nyrrRunnerName: 'Amy Zed' }), ctx('A0001'))
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
    expect(conn.commit).toHaveBeenCalled()

    const [nameSql, nameParams] = conn.execute.mock.calls[0]
    expect(nameSql).toMatch(/UPDATE members SET NYRRRunnerName = \?/)
    expect(nameParams).toEqual(['Amy Zed', 'A0001'])

    const backfill = conn.execute.mock.calls.find(([sql]) =>
      /match_method = 'auto_name'/.test(sql)
    )
    expect(backfill).toBeDefined()
    expect(backfill![1]).toEqual(['A0001', 'admin@mmr.org', 'Amy Zed'])
  })

  it('empty-string name updates member but skips backfill', async () => {
    const res = await patch(makeReq({ nyrrRunnerName: '' }), ctx('A0001'))
    expect(res.status).toBe(200)
    expect(conn.commit).toHaveBeenCalled()
    // only the members UPDATE ran — no backfill/count queries
    expect(conn.execute).toHaveBeenCalledTimes(1)
    const [nameSql, nameParams] = conn.execute.mock.calls[0]
    expect(nameSql).toMatch(/UPDATE members SET NYRRRunnerName = \?/)
    expect(nameParams).toEqual(['', 'A0001'])
  })
})

describe('PATCH /api/nyrr/members/[id]/edit-name — DB errors', () => {
  it('update failure → rollback + 500, connection released', async () => {
    conn.execute.mockRejectedValueOnce(new Error('deadlock'))
    const res = await patch(makeReq({ nyrrRunnerName: 'Amy Zed' }), ctx('A0001'))
    expect(res.status).toBe(500)
    expect(conn.rollback).toHaveBeenCalled()
    expect(conn.release).toHaveBeenCalled()
  })
})
