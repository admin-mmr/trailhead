/**
 * Contract tests for POST /api/members/register
 *
 * Mocks member helpers. Verifies: idempotent-by-email behavior
 * (existing member → 200, no create), creation path (201), zod
 * validation rejection, and the DB error path.
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

jest.mock('@/lib/db/members', () => ({
  findMemberByEmail: jest.fn(),
  createNewMember: jest.fn(),
}))

import { POST } from '@/app/api/members/register/route'

// tsc sees the real NextResponse types; the runtime mock returns { status, body }.
const post = POST as unknown as (req: unknown) => Promise<{ status: number; body: any }>
import { findMemberByEmail, createNewMember } from '@/lib/db/members'

const mockFindByEmail = findMemberByEmail as jest.Mock
const mockCreate = createNewMember as jest.Mock

const validBody = {
  email: 'amy@example.com',
  firstName: 'Amy',
  membershipType: 'individual',
}

function makeReq(body: unknown) {
  return { json: async () => body } as any
}

beforeEach(() => {
  jest.clearAllMocks()
})

describe('POST /api/members/register — idempotency', () => {
  it('returns the existing member with 200 and does not create a new one', async () => {
    const existing = { memberId: 'MMR-2025-0007', email: 'amy@example.com', status: 'active' }
    mockFindByEmail.mockResolvedValue(existing)

    const res = await post(makeReq(validBody))

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ ok: true, data: existing })
    expect(mockCreate).not.toHaveBeenCalled()
  })
})

describe('POST /api/members/register — creation', () => {
  it('creates a new member and returns 201', async () => {
    const created = { memberId: 'MMR-2026-0042', email: 'amy@example.com', status: 'pending' }
    mockFindByEmail.mockResolvedValue(null)
    mockCreate.mockResolvedValue(created)

    const res = await post(makeReq({
      ...validBody,
      lastName: 'Lee',
      phone: '5551234567',
      wechatId: 'amy-wx',
    }))

    expect(res.status).toBe(201)
    expect(res.body).toEqual({ ok: true, data: created })
    expect(mockCreate).toHaveBeenCalledWith({
      email: 'amy@example.com',
      firstName: 'Amy',
      lastName: 'Lee',
      phone: '5551234567',
      wechatId: 'amy-wx',
      membershipType: 'individual',
    })
  })
})

describe('POST /api/members/register — validation', () => {
  it.each([
    ['bad email', { ...validBody, email: 'nope' }],
    ['missing firstName', { ...validBody, firstName: '' }],
    ['bad membershipType', { ...validBody, membershipType: 'corporate' }],
    ['empty body', {}],
  ])('rejects %s with 400 and does not touch the DB', async (_label, body) => {
    const res = await post(makeReq(body))
    expect(res.status).toBe(400)
    expect(res.body).toEqual({ ok: false, error: 'Invalid input.' })
    expect(mockFindByEmail).not.toHaveBeenCalled()
    expect(mockCreate).not.toHaveBeenCalled()
  })
})

describe('POST /api/members/register — DB errors', () => {
  it('lookup failure → 500', async () => {
    mockFindByEmail.mockRejectedValue(new Error('connect ETIMEDOUT'))
    const res = await post(makeReq(validBody))
    expect(res.status).toBe(500)
    expect(res.body).toEqual({ ok: false, error: 'Registration failed.' })
  })

  it('create failure → 500', async () => {
    mockFindByEmail.mockResolvedValue(null)
    mockCreate.mockRejectedValue(new Error('deadlock'))
    const res = await post(makeReq(validBody))
    expect(res.status).toBe(500)
    expect(res.body.ok).toBe(false)
  })
})
