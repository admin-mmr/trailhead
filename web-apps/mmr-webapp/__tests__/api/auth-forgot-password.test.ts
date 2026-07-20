/**
 * Contract tests for POST /api/auth/forgot-password
 *
 * Mocks getDb, member helpers, and email client/templates. Verifies:
 * anti-enumeration (unknown email → 200 with no side effects),
 * token invalidate + insert SQL params, that only the SHA-256 hash of
 * the emailed token is stored, validation rejection, and error paths.
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
  getDb: jest.fn(),
  pool: {},
}))
jest.mock('@/lib/db/members', () => ({
  findMemberByEmail: jest.fn(),
}))
jest.mock('@/lib/email/client', () => ({
  sendEmail: jest.fn(),
}))
jest.mock('@/lib/email/templates', () => ({
  passwordResetEmailHtml: jest.fn(() => '<html>reset</html>'),
}))

import crypto from 'crypto'
import { POST } from '@/app/api/auth/forgot-password/route'

// tsc sees the real NextResponse types; the runtime mock returns { status, body }.
const post = POST as unknown as (req: unknown) => Promise<{ status: number; body: any }>
import { getDb } from '@/lib/db/connection'
import { findMemberByEmail } from '@/lib/db/members'
import { sendEmail } from '@/lib/email/client'
import { passwordResetEmailHtml } from '@/lib/email/templates'

const mockGetDb = getDb as jest.Mock
const mockFindByEmail = findMemberByEmail as jest.Mock
const mockSendEmail = sendEmail as jest.Mock
const mockTemplate = passwordResetEmailHtml as jest.Mock

const EMAIL = 'amy@example.com'
const MEMBER = { memberId: 'MMR-2026-0042', email: EMAIL, firstName: 'Amy' }

function makeReq(body: unknown) {
  return { json: async () => body } as any
}

let db: { execute: jest.Mock }

beforeEach(() => {
  jest.clearAllMocks()
  db = { execute: jest.fn().mockResolvedValue([{}]) }
  mockGetDb.mockReturnValue(db)
  mockFindByEmail.mockResolvedValue(MEMBER)
  mockSendEmail.mockResolvedValue(undefined)
})

// ── Anti-enumeration contract ─────────────────────────────────────────────────

describe('POST /api/auth/forgot-password — anti-enumeration', () => {
  it('unknown email → 200 ok with NO token write and NO email', async () => {
    mockFindByEmail.mockResolvedValue(null)
    const res = await post(makeReq({ email: 'ghost@example.com' }))
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ ok: true })
    expect(db.execute).not.toHaveBeenCalled()
    expect(mockSendEmail).not.toHaveBeenCalled()
  })
})

// ── Happy path ────────────────────────────────────────────────────────────────

describe('POST /api/auth/forgot-password — happy path', () => {
  it('invalidates old tokens, stores a hashed token, and emails the raw token', async () => {
    const res = await post(makeReq({ email: EMAIL }))
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ ok: true })

    // 1st execute: invalidate existing active tokens for this email
    const [invalidateSql, invalidateParams] = db.execute.mock.calls[0]
    expect(invalidateSql).toMatch(/UPDATE password_reset_tokens SET Used = 1/)
    expect(invalidateParams).toEqual([EMAIL])

    // 2nd execute: insert the new token row
    const [insertSql, insertParams] = db.execute.mock.calls[1]
    expect(insertSql).toMatch(/INSERT INTO password_reset_tokens/)
    const [tokenId, email, storedHash, expiresAt] = insertParams
    expect(tokenId).toMatch(/^PRT-\d+-[0-9a-f]{8}$/)
    expect(email).toBe(EMAIL)
    expect(storedHash).toMatch(/^[0-9a-f]{64}$/)  // SHA-256 hex, never the raw token
    expect(expiresAt).toBeInstanceOf(Date)

    // Email sent to the member with the password_reset type
    expect(mockSendEmail).toHaveBeenCalledWith(expect.objectContaining({
      to: EMAIL,
      subject: expect.stringMatching(/reset/i),
      emailType: 'password_reset',
    }))

    // The raw token in the reset URL must hash to the stored hash
    const { resetUrl } = mockTemplate.mock.calls[0][0]
    const rawToken = new URL(resetUrl).searchParams.get('token')!
    expect(rawToken).toMatch(/^[0-9a-f]{64}$/)
    expect(rawToken).not.toBe(storedHash)
    const recomputed = crypto.createHash('sha256').update(rawToken).digest('hex')
    expect(recomputed).toBe(storedHash)
  })
})

// ── Validation ────────────────────────────────────────────────────────────────

describe('POST /api/auth/forgot-password — validation', () => {
  it.each([
    ['bad email', { email: 'nope' }],
    ['missing email', {}],
  ])('rejects %s with 400', async (_label, body) => {
    const res = await post(makeReq(body))
    expect(res.status).toBe(400)
    expect(res.body).toEqual({ ok: false, error: 'Invalid email.' })
    expect(mockFindByEmail).not.toHaveBeenCalled()
  })
})

// ── Error paths ───────────────────────────────────────────────────────────────

describe('POST /api/auth/forgot-password — errors', () => {
  it('DB failure on token write → 500', async () => {
    db.execute.mockRejectedValue(new Error('connect ETIMEDOUT'))
    const res = await post(makeReq({ email: EMAIL }))
    expect(res.status).toBe(500)
    expect(res.body).toEqual({ ok: false, error: 'Request failed.' })
  })

  // Current behavior: sendEmail is awaited inside the try block, so an email
  // provider outage returns 500 even though the token row was already stored.
  it('email send failure → 500 (current behavior; token already stored)', async () => {
    mockSendEmail.mockRejectedValue(new Error('SMTP down'))
    const res = await post(makeReq({ email: EMAIL }))
    expect(res.status).toBe(500)
    expect(db.execute).toHaveBeenCalledTimes(2)  // token was written before the failure
  })
})
