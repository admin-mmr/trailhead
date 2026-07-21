/**
 * Contract tests for DELETE /api/nyrr/match/[id]
 *
 * Admin-only, transactional. Plain params { id }. Unlinks a match, optionally
 * clears the member NYRRRunnerName (?clearName=true), recomputes event count.
 * parseInt(id) → 400 if NaN; missing runner → 404. release() on every path.
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

import { DELETE } from '@/app/api/nyrr/match/[id]/route'
import { requireSession } from '@/lib/auth/session'
import { isAdmin } from '@/lib/db/admins'
import db from '@/lib/db/connection'

const del = DELETE as unknown as (req: unknown, ctx: any) => Promise<{ status: number; body: any }>
const mockRequireSession = requireSession as jest.Mock
const mockIsAdmin = isAdmin as jest.Mock
const mockGetConnection = db.getConnection as unknown as jest.Mock

const makeReq = (url = 'http://x/api/nyrr/match/11') =>
  ({ url, nextUrl: { searchParams: new URLSearchParams(url.split('?')[1] || '') } } as any)
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

describe('DELETE /api/nyrr/match/[id] — auth & validation', () => {
  it('no session → 401, connection released', async () => {
    mockRequireSession.mockRejectedValue(new Error('Unauthorized'))
    const res = await del(makeReq(), ctx('11'))
    expect(res.status).toBe(401)
    expect(conn.release).toHaveBeenCalled()
    expect(conn.beginTransaction).not.toHaveBeenCalled()
  })

  it('non-admin → 403, connection released', async () => {
    mockIsAdmin.mockResolvedValue(false)
    const res = await del(makeReq(), ctx('11'))
    expect(res.status).toBe(403)
    expect(conn.release).toHaveBeenCalled()
  })

  it('non-numeric id → 400, connection released', async () => {
    const res = await del(makeReq(), ctx('nope'))
    expect(res.status).toBe(400)
    expect(res.body.error).toBe('Invalid runner ID')
    expect(conn.release).toHaveBeenCalled()
    expect(conn.beginTransaction).not.toHaveBeenCalled()
  })
})

describe('DELETE /api/nyrr/match/[id] — happy path', () => {
  it('unlinks match and recomputes count without clearing name by default', async () => {
    conn.execute
      .mockResolvedValueOnce([[{ mmr_member_id: 'A0001', nyrr_event_id: 5 }]]) // SELECT runner
      .mockResolvedValueOnce([[]]) // UPDATE clear match
      .mockResolvedValueOnce([[{ count: 2 }]]) // SELECT COUNT
      .mockResolvedValueOnce([[]]) // UPDATE event count

    const res = await del(makeReq(), ctx('11'))
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
    expect(conn.commit).toHaveBeenCalled()

    // clear-match UPDATE targets the runner id
    const [clearSql, clearParams] = conn.execute.mock.calls[1]
    expect(clearSql).toMatch(/match_method = 'unmatched'/)
    expect(clearParams).toEqual([11])

    // no NYRRRunnerName clear query when clearName not set
    const clearedName = conn.execute.mock.calls.some(([sql]) =>
      /SET NYRRRunnerName = NULL/.test(sql)
    )
    expect(clearedName).toBe(false)

    const [countSql, countParams] = conn.execute.mock.calls[3]
    expect(countSql).toMatch(/UPDATE nyrr_events SET mmr_matched_count = \?/)
    expect(countParams).toEqual([2, 5])
  })

  it('clears member NYRRRunnerName when clearName=true', async () => {
    conn.execute
      .mockResolvedValueOnce([[{ mmr_member_id: 'A0001', nyrr_event_id: 5 }]])
      .mockResolvedValueOnce([[]]) // clear match
      .mockResolvedValueOnce([[]]) // clear name
      .mockResolvedValueOnce([[{ count: 0 }]])
      .mockResolvedValueOnce([[]])

    const res = await del(makeReq('http://x/api/nyrr/match/11?clearName=true'), ctx('11'))
    expect(res.status).toBe(200)
    const clearedName = conn.execute.mock.calls.find(([sql]) =>
      /SET NYRRRunnerName = NULL/.test(sql)
    )
    expect(clearedName).toBeDefined()
    expect(clearedName![1]).toEqual(['A0001'])
  })
})

describe('DELETE /api/nyrr/match/[id] — runner not found', () => {
  it('missing runner → rollback + 404, connection released', async () => {
    conn.execute.mockResolvedValueOnce([[]])
    const res = await del(makeReq(), ctx('999'))
    expect(res.status).toBe(404)
    expect(res.body.error).toBe('Runner not found')
    expect(conn.rollback).toHaveBeenCalled()
    expect(conn.release).toHaveBeenCalled()
  })
})

describe('DELETE /api/nyrr/match/[id] — DB errors', () => {
  it('update failure → rollback + 500, connection released', async () => {
    conn.execute
      .mockResolvedValueOnce([[{ mmr_member_id: 'A0001', nyrr_event_id: 5 }]])
      .mockRejectedValueOnce(new Error('deadlock'))
    const res = await del(makeReq(), ctx('11'))
    expect(res.status).toBe(500)
    expect(conn.rollback).toHaveBeenCalled()
    expect(conn.release).toHaveBeenCalled()
  })
})
