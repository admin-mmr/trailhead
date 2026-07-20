/**
 * Contract tests for POST /api/members/enroll
 *
 * Mocks member helpers and sheets sync. Verifies: happy-path response
 * shape (memberId + isExisting flag), plan → membershipType mapping,
 * zod validation rejections (gender enum, phone preprocess, yearBorn
 * bounds), non-fatal sheets failure, and the DB error path.
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
  findOrCreateMember: jest.fn(),
}))
jest.mock('@/lib/sheets/sync', () => ({
  syncMemberToSheets: jest.fn(),
}))

import { POST } from '@/app/api/members/enroll/route'

// tsc sees the real NextResponse types; the runtime mock returns { status, body }.
const post = POST as unknown as (req: unknown) => Promise<{ status: number; body: any }>
import { findOrCreateMember } from '@/lib/db/members'
import { syncMemberToSheets } from '@/lib/sheets/sync'

const mockFindOrCreate = findOrCreateMember as jest.Mock
const mockSyncMember = syncMemberToSheets as jest.Mock

const validBody = {
  plan: 'individual',
  firstName: 'Amy',
  lastName: 'Lee',
  email: 'amy@example.com',
  phone: '5551234567',
  gender: 'Female',
}

function makeReq(body: unknown) {
  return { json: async () => body } as any
}

function freshMember(createdAt: string) {
  return { memberId: 'MMR-2026-0042', email: 'amy@example.com', createdAt }
}

beforeEach(() => {
  jest.clearAllMocks()
  mockFindOrCreate.mockResolvedValue(freshMember(new Date().toISOString()))
  mockSyncMember.mockResolvedValue(undefined)
})

// ── Happy path ────────────────────────────────────────────────────────────────

describe('POST /api/members/enroll — happy path', () => {
  it('returns 200 with memberId; isExisting=false for a just-created member', async () => {
    const res = await post(makeReq(validBody))
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ ok: true, memberId: 'MMR-2026-0042', isExisting: false })
  })

  it('isExisting=true when the member record is older than 5 seconds', async () => {
    mockFindOrCreate.mockResolvedValue(freshMember('2025-01-01T00:00:00.000Z'))
    const res = await post(makeReq(validBody))
    expect(res.body.isExisting).toBe(true)
  })

  it.each([
    ['individual', 'individual'],
    ['family', 'family'],
    ['family_upgrade', 'family'],
  ])('plan "%s" maps to membershipType "%s"', async (plan, membershipType) => {
    await post(makeReq({ ...validBody, plan }))
    expect(mockFindOrCreate.mock.calls[0][0].membershipType).toBe(membershipType)
  })

  it('passes full profile through to findOrCreateMember', async () => {
    await post(makeReq({
      ...validBody,
      wechatId: 'amy-wx',
      district: 'Queens',
      yearBorn: 1990,
      nyrrRunnerName: 'Amy Lee',
    }))
    expect(mockFindOrCreate).toHaveBeenCalledWith({
      email: 'amy@example.com',
      firstName: 'Amy',
      lastName: 'Lee',
      phone: '5551234567',
      wechatId: 'amy-wx',
      district: 'Queens',
      gender: 'Female',
      yearBorn: 1990,
      nyrrRunnerName: 'Amy Lee',
      membershipType: 'individual',
    })
  })

  it('sheets sync failure is non-fatal (still 200)', async () => {
    mockSyncMember.mockRejectedValue(new Error('Sheets API down'))
    const res = await post(makeReq(validBody))
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
  })
})

// ── Validation rejections ─────────────────────────────────────────────────────

describe('POST /api/members/enroll — validation', () => {
  it.each([
    ['unknown plan', { ...validBody, plan: 'lifetime' }],
    ['bad email', { ...validBody, email: 'nope' }],
    ['missing firstName', { ...validBody, firstName: '' }],
    ['invalid gender', { ...validBody, gender: 'Other' }],
    ['missing gender', { ...validBody, gender: undefined }],
    ['short phone', { ...validBody, phone: '123' }],
    ['yearBorn too early', { ...validBody, yearBorn: 1899 }],
    ['yearBorn in the future', { ...validBody, yearBorn: new Date().getFullYear() + 1 }],
  ])('rejects %s with 400 and does not touch the DB', async (_label, body) => {
    const res = await post(makeReq(body))
    expect(res.status).toBe(400)
    expect(res.body.error).toBe('Invalid input')
    expect(res.body.details).toBeDefined()
    expect(mockFindOrCreate).not.toHaveBeenCalled()
  })

  it('empty-string phone is coerced to undefined (accepted)', async () => {
    const res = await post(makeReq({ ...validBody, phone: '' }))
    expect(res.status).toBe(200)
    expect(mockFindOrCreate.mock.calls[0][0].phone).toBeUndefined()
  })

  it('empty-string yearBorn is coerced to undefined (accepted)', async () => {
    const res = await post(makeReq({ ...validBody, yearBorn: '' }))
    expect(res.status).toBe(200)
    expect(mockFindOrCreate.mock.calls[0][0].yearBorn).toBeUndefined()
  })
})

// ── DB error path ─────────────────────────────────────────────────────────────

describe('POST /api/members/enroll — DB errors', () => {
  it('findOrCreateMember failure → 500 with generic message', async () => {
    mockFindOrCreate.mockRejectedValue(new Error('DB gone'))
    const res = await post(makeReq(validBody))
    expect(res.status).toBe(500)
    expect(res.body.error).toMatch(/Enrollment failed/)
    expect(mockSyncMember).not.toHaveBeenCalled()
  })
})
