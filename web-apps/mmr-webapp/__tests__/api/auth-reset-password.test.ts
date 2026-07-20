/**
 * Contract tests for POST /api/auth/reset-password
 *
 * Mocks getDb, member helpers, and hashPassword. Verifies: token lookup
 * by SHA-256 hash, rejection of unknown / used / expired tokens, member
 * lookup, password update + token consumption on the happy path,
 * validation rejections, and the DB error path.
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
  setMemberPassword: jest.fn(),
}))
jest.mock('@/lib/auth/password', () => ({
  hashPassword: jest.fn(async () => '$2a$10$hashedpassword'),
}))

import crypto from 'crypto'
import { POST } from '@/app/api/auth/reset-password/route'

// tsc sees the real NextResponse types; the runtime mock returns { status, body }.
const post = POST as unknown as (req: unknown) => Promise<{ status: number; body: any }>
import { getDb } from '@/lib/db/connection'
import { findMemberByEmail, setMemberPassword } from '@/lib/db/members'
import { hashPassword } from '@/lib/auth/password'

const mockGetDb = getDb as jest.Mock
const mockFindByEmail = findMemberByEmail as jest.Mock
const mockSetPassword = setMemberPassword as jest.Mock
const mockHashPassword = hashPassword as jest.Mock

const RAW_TOKEN = 'a'.repeat(64)
const TOKEN_HASH = crypto.createHash('sha256').update(RAW_TOKEN).digest('hex')
const EMAIL = 'amy@example.com'
const MEMBER = { memberId: 'MMR-2026-0042', email: EMAIL }

function tokenRow(overrides: Partial<{ used: number; expires_at: Date }> = {}) {
  return {
    token_id: 'PRT-1-deadbeef',
    email: EMAIL,
    expires_at: new Date(Date.now() + 60 * 60 * 1000),  // +1h
    used: 0,
    ...overrides,
  }
}

function makeReq(body: unknown) {
  return { json: async () => body } as any
}

let db: { execute: jest.Mock }

beforeEach(() => {
  jest.clearAllMocks()
  db = { execute: jest.fn().mockResolvedValue([{}]) }
  mockGetDb.mockReturnValue(db)
  mockFindByEmail.mockResolvedValue(MEMBER)
  mockSetPassword.mockResolvedValue(undefined)
})

// ── Token gating ──────────────────────────────────────────────────────────────

describe('POST /api/auth/reset-password — token gating', () => {
  it('unknown token → 400 with no password change', async () => {
    db.execute.mockResolvedValueOnce([[]])
    const res = await post(makeReq({ token: RAW_TOKEN, password: 'newpassword1' }))
    expect(res.status).toBe(400)
    expect(res.body.error).toBe('Invalid or expired link.')
    expect(mockSetPassword).not.toHaveBeenCalled()
  })

  it('looks the token up by its SHA-256 hash, never the raw value', async () => {
    db.execute.mockResolvedValueOnce([[]])
    await post(makeReq({ token: RAW_TOKEN, password: 'newpassword1' }))
    const [sql, params] = db.execute.mock.calls[0]
    expect(sql).toMatch(/WHERE TokenHash = \?/)
    expect(params).toEqual([TOKEN_HASH])
  })

  it('already-used token → 400', async () => {
    db.execute.mockResolvedValueOnce([[tokenRow({ used: 1 })]])
    const res = await post(makeReq({ token: RAW_TOKEN, password: 'newpassword1' }))
    expect(res.status).toBe(400)
    expect(res.body.error).toBe('This link has already been used.')
    expect(mockSetPassword).not.toHaveBeenCalled()
  })

  it('expired token → 400', async () => {
    db.execute.mockResolvedValueOnce([[tokenRow({ expires_at: new Date(Date.now() - 1000) })]])
    const res = await post(makeReq({ token: RAW_TOKEN, password: 'newpassword1' }))
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/expired/)
    expect(mockSetPassword).not.toHaveBeenCalled()
  })

  it('valid token but member gone → 404', async () => {
    db.execute.mockResolvedValueOnce([[tokenRow()]])
    mockFindByEmail.mockResolvedValue(null)
    const res = await post(makeReq({ token: RAW_TOKEN, password: 'newpassword1' }))
    expect(res.status).toBe(404)
    expect(res.body.error).toBe('Account not found.')
    expect(mockSetPassword).not.toHaveBeenCalled()
  })
})

// ── Happy path ────────────────────────────────────────────────────────────────

describe('POST /api/auth/reset-password — happy path', () => {
  it('hashes the new password, stores it, and consumes the token', async () => {
    db.execute
      .mockResolvedValueOnce([[tokenRow()]])  // SELECT token
      .mockResolvedValueOnce([{}])            // UPDATE Used = 1

    const res = await post(makeReq({ token: RAW_TOKEN, password: 'newpassword1' }))

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ ok: true })

    expect(mockFindByEmail).toHaveBeenCalledWith(EMAIL)
    expect(mockHashPassword).toHaveBeenCalledWith('newpassword1')
    expect(mockSetPassword).toHaveBeenCalledWith('MMR-2026-0042', '$2a$10$hashedpassword')

    const [usedSql, usedParams] = db.execute.mock.calls[1]
    expect(usedSql).toMatch(/UPDATE password_reset_tokens SET Used = 1 WHERE TokenID = \?/)
    expect(usedParams).toEqual(['PRT-1-deadbeef'])
  })
})

// ── Validation ────────────────────────────────────────────────────────────────

describe('POST /api/auth/reset-password — validation', () => {
  it.each([
    ['missing token', { password: 'newpassword1' }],
    ['empty token', { token: '', password: 'newpassword1' }],
    ['short password', { token: RAW_TOKEN, password: 'short' }],
    ['missing password', { token: RAW_TOKEN }],
  ])('rejects %s with 400', async (_label, body) => {
    const res = await post(makeReq(body))
    expect(res.status).toBe(400)
    expect(res.body).toEqual({ ok: false, error: 'Invalid input.' })
    expect(db.execute).not.toHaveBeenCalled()
  })
})

// ── DB error path ─────────────────────────────────────────────────────────────

describe('POST /api/auth/reset-password — DB errors', () => {
  it('token lookup failure → 500', async () => {
    db.execute.mockRejectedValue(new Error('connect ETIMEDOUT'))
    const res = await post(makeReq({ token: RAW_TOKEN, password: 'newpassword1' }))
    expect(res.status).toBe(500)
    expect(res.body).toEqual({ ok: false, error: 'Reset failed.' })
  })

  it('setMemberPassword failure → 500 and token NOT consumed', async () => {
    db.execute.mockResolvedValueOnce([[tokenRow()]])
    mockSetPassword.mockRejectedValue(new Error('deadlock'))
    const res = await post(makeReq({ token: RAW_TOKEN, password: 'newpassword1' }))
    expect(res.status).toBe(500)
    expect(db.execute).toHaveBeenCalledTimes(1)  // no Used=1 update after the failure
  })
})
