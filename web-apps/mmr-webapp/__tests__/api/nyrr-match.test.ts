/**
 * Contract tests for POST /api/nyrr/match
 *
 * Admin-only, transactional (db.getConnection()). The connection is acquired
 * BEFORE the auth check, so release() must fire on every early return.
 * Confirms a manual match, backfills same-name runners, recomputes counts.
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

import { POST } from '@/app/api/nyrr/match/route'
import { requireSession } from '@/lib/auth/session'
import { isAdmin } from '@/lib/db/admins'
import db from '@/lib/db/connection'

const post = POST as unknown as (req: unknown) => Promise<{ status: number; body: any }>
const mockRequireSession = requireSession as jest.Mock
const mockIsAdmin = isAdmin as jest.Mock
const mockGetConnection = db.getConnection as unknown as jest.Mock

const makeReq = (body: any) => ({ json: async () => body } as any)

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

describe('POST /api/nyrr/match — auth', () => {
  it('no session → 401, connection released', async () => {
    mockRequireSession.mockRejectedValue(new Error('Unauthorized'))
    const res = await post(makeReq({ runnerId: 1, memberId: 'A0001' }))
    expect(res.status).toBe(401)
    expect(conn.release).toHaveBeenCalled()
    expect(conn.beginTransaction).not.toHaveBeenCalled()
  })

  it('non-admin → 403, connection released', async () => {
    mockIsAdmin.mockResolvedValue(false)
    const res = await post(makeReq({ runnerId: 1, memberId: 'A0001' }))
    expect(res.status).toBe(403)
    expect(conn.release).toHaveBeenCalled()
  })
})

describe('POST /api/nyrr/match — validation', () => {
  it('missing runnerId/memberId → 400, connection released', async () => {
    const res = await post(makeReq({ runnerId: 1 }))
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/required/)
    expect(conn.release).toHaveBeenCalled()
    expect(conn.beginTransaction).not.toHaveBeenCalled()
  })
})

describe('POST /api/nyrr/match — happy path', () => {
  it('matches, backfills, updates counts, commits → 201', async () => {
    conn.execute
      .mockResolvedValueOnce([[{ runner_name: 'Amy Zed', nyrr_event_id: 5 }]]) // SELECT runner
      .mockResolvedValueOnce([[]]) // UPDATE runner (manual)
      .mockResolvedValueOnce([[]]) // UPDATE members NYRRRunnerName
      .mockResolvedValueOnce([[]]) // UPDATE backfill same-name
      .mockResolvedValueOnce([[{ nyrr_event_id: 5 }]]) // SELECT DISTINCT affected events
      .mockResolvedValueOnce([[{ count: 3 }]]) // SELECT COUNT matched
      .mockResolvedValueOnce([[]]) // UPDATE nyrr_events count

    const res = await post(makeReq({ runnerId: 11, memberId: 'A0001' }))
    expect(res.status).toBe(201)
    expect(res.body.ok).toBe(true)
    expect(conn.beginTransaction).toHaveBeenCalled()
    expect(conn.commit).toHaveBeenCalled()
    expect(conn.rollback).not.toHaveBeenCalled()

    // manual-match UPDATE stamps member + session email + runner id
    const [manualSql, manualParams] = conn.execute.mock.calls[1]
    expect(manualSql).toMatch(/UPDATE nyrr_event_runners/)
    expect(manualSql).toMatch(/match_method = 'manual'/)
    expect(manualParams).toEqual(['A0001', 'admin@mmr.org', 11])

    // recomputed count written back to the event
    const [countSql, countParams] = conn.execute.mock.calls[6]
    expect(countSql).toMatch(/UPDATE nyrr_events SET mmr_matched_count = \?/)
    expect(countParams).toEqual([3, 5])
  })
})

describe('POST /api/nyrr/match — runner not found', () => {
  it('missing runner → rollback + 404, connection released', async () => {
    conn.execute.mockResolvedValueOnce([[]]) // SELECT runner returns nothing
    const res = await post(makeReq({ runnerId: 999, memberId: 'A0001' }))
    expect(res.status).toBe(404)
    expect(res.body.error).toBe('Runner not found')
    expect(conn.rollback).toHaveBeenCalled()
    expect(conn.release).toHaveBeenCalled()
  })
})

describe('POST /api/nyrr/match — DB errors', () => {
  it('update failure → rollback + 500, connection released', async () => {
    conn.execute
      .mockResolvedValueOnce([[{ runner_name: 'Amy Zed', nyrr_event_id: 5 }]])
      .mockRejectedValueOnce(new Error('deadlock'))
    const res = await post(makeReq({ runnerId: 11, memberId: 'A0001' }))
    expect(res.status).toBe(500)
    expect(conn.rollback).toHaveBeenCalled()
    expect(conn.release).toHaveBeenCalled()
  })
})
