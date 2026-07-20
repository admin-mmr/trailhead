/**
 * Contract tests for POST /api/payments/submit
 *
 * Mocks the mysql2 pool, member helpers, email client, sheets sync, and nanoid.
 * Verifies: happy-path SQL params + response shape, zod validation rejections,
 * non-fatal email/sheets failures, and DB error paths (generic + ER_DUP_ENTRY).
 */

// ── Mock next/server (same convention as middleware.test.ts) ─────────────────
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
jest.mock('@/lib/db/members', () => ({
  findOrCreateMember: jest.fn(),
}))
jest.mock('@/lib/email/client', () => ({
  sendApplicationReceivedEmail: jest.fn(),
}))
jest.mock('@/lib/sheets/sync', () => ({
  syncMemberToSheets: jest.fn(),
  syncEventToSheets: jest.fn(),
}))
// nanoid v5 is ESM-only; the factory keeps jest from loading the real module
// and makes submission IDs deterministic.
jest.mock('nanoid', () => ({ nanoid: jest.fn(() => 'abc12') }))

import { POST } from '@/app/api/payments/submit/route'

// tsc sees the real NextResponse types; the runtime mock returns { status, body }.
const post = POST as unknown as (req: unknown) => Promise<{ status: number; body: any }>
import { pool } from '@/lib/db/connection'
import { findOrCreateMember } from '@/lib/db/members'
import { sendApplicationReceivedEmail } from '@/lib/email/client'
import { syncMemberToSheets } from '@/lib/sheets/sync'

const mockGetConnection = pool.getConnection as jest.Mock
const mockFindOrCreate = findOrCreateMember as jest.Mock
const mockSendEmail = sendApplicationReceivedEmail as jest.Mock
const mockSyncMember = syncMemberToSheets as jest.Mock

// ── Helpers ──────────────────────────────────────────────────────────────────
const MEMBER = {
  memberId: 'MMR-2026-0042',
  email: 'amy@example.com',
  firstName: 'Amy',
  lastName: 'Lee',
  createdAt: new Date().toISOString(),
}

const validBody = {
  plan: 'individual',
  amount: 30,
  paymentMethod: 'zelle',
  firstName: 'Amy',
  lastName: 'Lee',
  email: 'amy@example.com',
  phone: '5551234567',
  payerName: 'Amy L Lee',
  paymentDate: '2026-07-01',
}

function makeReq(body: unknown) {
  return { json: async () => body } as any
}

let conn: { execute: jest.Mock; release: jest.Mock }

beforeEach(() => {
  jest.clearAllMocks()
  conn = { execute: jest.fn().mockResolvedValue([{}]), release: jest.fn() }
  mockGetConnection.mockResolvedValue(conn)
  mockFindOrCreate.mockResolvedValue(MEMBER)
  mockSendEmail.mockResolvedValue(undefined)
  mockSyncMember.mockResolvedValue(undefined)
})

// ── Happy path ────────────────────────────────────────────────────────────────

describe('POST /api/payments/submit — happy path', () => {
  it('returns 201 with submissionId and memberId', async () => {
    const res = await post(makeReq(validBody))
    expect(res.status).toBe(201)
    expect(res.body.memberId).toBe('MMR-2026-0042')
    expect(res.body.submissionId).toMatch(/^SUB-\d{8}-ABC12$/)
  })

  it('passes member info through to findOrCreateMember', async () => {
    await post(makeReq({ ...validBody, wechatId: 'amy-wx', district: 'Queens', gender: 'Female', yearBorn: 1990 }))
    expect(mockFindOrCreate).toHaveBeenCalledWith({
      email: 'amy@example.com',
      firstName: 'Amy',
      lastName: 'Lee',
      phone: '5551234567',
      wechatId: 'amy-wx',
      district: 'Queens',
      gender: 'Female',
      yearBorn: 1990,
      nyrrRunnerName: undefined,
    })
  })

  it('inserts a pending submissions row with correct SQL params', async () => {
    const res = await post(makeReq(validBody))
    expect(conn.execute).toHaveBeenCalledTimes(1)
    const [sql, params] = conn.execute.mock.calls[0]
    expect(sql).toMatch(/INSERT INTO submissions/)
    expect(sql).toMatch(/'membership_payment'/)
    expect(sql).toMatch(/'pending'/)
    expect(params[0]).toBe(res.body.submissionId)
    expect(params[1]).toBe('MMR-2026-0042')
    expect(params[2]).toBe(30)
    expect(params[3]).toBe('Individual Membership')
    expect(params[4]).toBe('zelle')
    expect(params[5]).toBe('Amy L Lee')
    expect(params[6]).toBe('2026-07-01')
    expect(params[7]).toBeNull()   // memoField
    expect(params[8]).toBeNull()   // last4
    expect(params[9]).toBeInstanceOf(Date)  // expiresAt (+14 days)
    expect(conn.release).toHaveBeenCalled()
  })

  it.each([
    ['individual', 'Individual Membership'],
    ['family', 'Family Membership'],
    ['family_upgrade', 'Family Upgrade'],
  ])('maps plan "%s" to PaymentIntent "%s"', async (plan, intent) => {
    await post(makeReq({ ...validBody, plan }))
    expect(conn.execute.mock.calls[0][1][3]).toBe(intent)
  })

  it('sends the application-received email with the submission reference', async () => {
    const res = await post(makeReq(validBody))
    expect(mockSendEmail).toHaveBeenCalledWith({
      to: 'amy@example.com',
      firstName: 'Amy',
      planLabel: 'Individual Membership',
      amount: 30,
      paymentMethod: 'zelle',
      referenceId: res.body.submissionId,
    })
  })

  it('email failure is non-fatal (still 201)', async () => {
    mockSendEmail.mockRejectedValue(new Error('SMTP down'))
    const res = await post(makeReq(validBody))
    expect(res.status).toBe(201)
  })

  it('sheets sync failure is non-fatal (still 201)', async () => {
    mockSyncMember.mockRejectedValue(new Error('Sheets API down'))
    const res = await post(makeReq(validBody))
    expect(res.status).toBe(201)
    expect(mockSyncMember).toHaveBeenCalledWith(MEMBER)
  })
})

// ── Validation rejections ─────────────────────────────────────────────────────

describe('POST /api/payments/submit — validation', () => {
  it.each([
    ['missing plan', { ...validBody, plan: undefined }],
    ['unknown plan', { ...validBody, plan: 'lifetime' }],
    ['negative amount', { ...validBody, amount: -5 }],
    ['zero amount', { ...validBody, amount: 0 }],
    ['bad payment method', { ...validBody, paymentMethod: 'paypal' }],
    ['bad email', { ...validBody, email: 'not-an-email' }],
    ['short phone', { ...validBody, phone: '123' }],
    ['missing payerName', { ...validBody, payerName: '' }],
    ['last4 too long', { ...validBody, last4: '12345' }],
  ])('rejects %s with 400 and does not touch the DB', async (_label, body) => {
    const res = await post(makeReq(body))
    expect(res.status).toBe(400)
    expect(res.body.error).toBe('Invalid input')
    expect(res.body.details).toBeDefined()
    expect(mockFindOrCreate).not.toHaveBeenCalled()
    expect(mockGetConnection).not.toHaveBeenCalled()
  })

  it('coerces empty-string yearBorn to undefined (accepted)', async () => {
    const res = await post(makeReq({ ...validBody, yearBorn: '' }))
    expect(res.status).toBe(201)
    expect(mockFindOrCreate.mock.calls[0][0].yearBorn).toBeUndefined()
  })

  // Current behavior: an unparseable JSON body throws inside the outer
  // try/catch and surfaces as 500 (a 400 would arguably be more correct).
  it('malformed JSON body returns 500 (current behavior)', async () => {
    const req = { json: async () => { throw new SyntaxError('bad json') } } as any
    const res = await post(req)
    expect(res.status).toBe(500)
  })
})

// ── DB error paths ────────────────────────────────────────────────────────────

describe('POST /api/payments/submit — DB errors', () => {
  it('generic DB error → 500 with generic message', async () => {
    conn.execute.mockRejectedValue(new Error('connect ETIMEDOUT'))
    const res = await post(makeReq(validBody))
    expect(res.status).toBe(500)
    expect(res.body.error).toMatch(/Internal server error/)
    expect(conn.release).toHaveBeenCalled()  // finally releases even on error
  })

  it('ER_DUP_ENTRY → 500 with duplicate-application message', async () => {
    const dup: any = new Error('Duplicate entry')
    dup.code = 'ER_DUP_ENTRY'
    conn.execute.mockRejectedValue(dup)
    const res = await post(makeReq(validBody))
    expect(res.status).toBe(500)
    expect(res.body.error).toMatch(/pending application already exists/)
  })

  it('findOrCreateMember failure → 500', async () => {
    mockFindOrCreate.mockRejectedValue(new Error('DB gone'))
    const res = await post(makeReq(validBody))
    expect(res.status).toBe(500)
    expect(mockGetConnection).not.toHaveBeenCalled()
  })
})
