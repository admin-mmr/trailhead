/**
 * Contract tests for POST /api/donations/submit
 *
 * Mocks the mysql2 pool and nanoid. Verifies: happy-path INSERT params
 * (anonymous + member-linked donations), zod validation rejections,
 * and the DB error path. This route is public (no session required).
 */

// ── Mock next/server ─────────────────────────────────────────────────────────
jest.mock('next/server', () => ({
  NextRequest: class {},
  NextResponse: {
    json: jest.fn((body: unknown, init?: { status?: number }) => ({
      status: init?.status ?? 200,
      body,
    })),
  },
}))

jest.mock('@/lib/db/connection', () => ({
  pool: { getConnection: jest.fn() },
  getDb: jest.fn(),
}))
jest.mock('nanoid', () => ({ nanoid: jest.fn(() => 'xyz99') }))

import { POST } from '@/app/api/donations/submit/route'

// tsc sees the real NextResponse types; the runtime mock returns { status, body }.
const post = POST as unknown as (req: unknown) => Promise<{ status: number; body: any }>
import { pool } from '@/lib/db/connection'

const mockGetConnection = pool.getConnection as jest.Mock

const validBody = {
  amount: 100,
  paymentMethod: 'venmo',
  firstName: 'Bo',
  lastName: 'Chen',
  email: 'bo@example.com',
  payerName: 'Bo Chen',
  paymentDate: '2026-07-10',
}

function makeReq(body: unknown) {
  return { json: async () => body } as any
}

let conn: { execute: jest.Mock; release: jest.Mock }

beforeEach(() => {
  jest.clearAllMocks()
  conn = { execute: jest.fn().mockResolvedValue([{}]), release: jest.fn() }
  mockGetConnection.mockResolvedValue(conn)
})

// ── Happy path ────────────────────────────────────────────────────────────────

describe('POST /api/donations/submit — happy path', () => {
  it('returns 201 with submissionId and email', async () => {
    const res = await post(makeReq(validBody))
    expect(res.status).toBe(201)
    expect(res.body.email).toBe('bo@example.com')
    expect(res.body.submissionId).toMatch(/^SUB-\d{8}-XYZ99$/)
  })

  it('inserts a pending donation row; MemberID null for anonymous donors', async () => {
    const res = await post(makeReq(validBody))
    expect(conn.execute).toHaveBeenCalledTimes(1)
    const [sql, params] = conn.execute.mock.calls[0]
    expect(sql).toMatch(/INSERT INTO submissions/)
    expect(sql).toMatch(/'donation', 'Donation'/)
    expect(sql).toMatch(/'pending'/)
    expect(params[0]).toBe(res.body.submissionId)
    expect(params[1]).toBeNull()        // memberId
    expect(params[2]).toBe(100)         // amount
    expect(params[3]).toBe('venmo')     // paymentMethod
    expect(params[4]).toBe('Bo Chen')   // payerName
    expect(params[5]).toBe('2026-07-10')
    expect(params[6]).toBeNull()        // memoField
    expect(params[7]).toBeNull()        // last4
    expect(params[8]).toBeInstanceOf(Date)  // expiresAt (+7 days)
    expect(conn.release).toHaveBeenCalled()
  })

  it('accepts explicit memberId: null from anonymous donors (regression: 400 on prod)', async () => {
    const res = await post(makeReq({ ...validBody, memberId: null }))
    expect(res.status).toBe(201)
    expect(conn.execute.mock.calls[0][1][1]).toBeNull()
  })

  it('links MemberID when donor is a logged-in member', async () => {
    await post(makeReq({ ...validBody, memberId: 'MMR-2026-0042', memoField: 'GoTeam', last4: '1234' }))
    const params = conn.execute.mock.calls[0][1]
    expect(params[1]).toBe('MMR-2026-0042')
    expect(params[6]).toBe('GoTeam')
    expect(params[7]).toBe('1234')
  })
})

// ── Validation rejections ─────────────────────────────────────────────────────

describe('POST /api/donations/submit — validation', () => {
  it.each([
    ['negative amount', { ...validBody, amount: -1 }],
    ['zero amount', { ...validBody, amount: 0 }],
    ['bad payment method', { ...validBody, paymentMethod: 'cash' }],
    ['bad email', { ...validBody, email: 'nope' }],
    ['missing firstName', { ...validBody, firstName: '' }],
    ['missing payerName', { ...validBody, payerName: '' }],
    ['last4 too long', { ...validBody, last4: '56789' }],
  ])('rejects %s with 400 and does not touch the DB', async (_label, body) => {
    const res = await post(makeReq(body))
    expect(res.status).toBe(400)
    expect(res.body.error).toBe('Invalid input')
    expect(res.body.details).toBeDefined()
    expect(mockGetConnection).not.toHaveBeenCalled()
  })
})

// ── DB error path ─────────────────────────────────────────────────────────────

describe('POST /api/donations/submit — DB errors', () => {
  it('insert failure → 500, connection still released', async () => {
    conn.execute.mockRejectedValue(new Error('connect ETIMEDOUT'))
    const res = await post(makeReq(validBody))
    expect(res.status).toBe(500)
    expect(res.body.error).toBe('Internal server error')
    expect(conn.release).toHaveBeenCalled()
  })
})
