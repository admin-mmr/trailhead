/**
 * Contract tests for the member-facing NYRR results + self-service linking routes.
 *
 * The two invariants that matter:
 *  - results are scoped to the SESSION member (member A must never read member
 *    B's races — there is no id parameter, by design), and
 *  - the confirm step treats `runnerIds` as untrusted: a hand-crafted id for
 *    someone else's result must not be claimable.
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
  requireSession: jest.fn(),
  getSession: jest.fn(),
}))
jest.mock('@/lib/db/members', () => ({
  getMemberById: jest.fn(),
  updateMemberProfile: jest.fn(),
}))
jest.mock('@/lib/db/nyrr-results', () => ({
  ...jest.requireActual('@/lib/db/nyrr-results'),
  getMemberResults: jest.fn(),
  findRunnerCandidates: jest.fn(),
  confirmRunnerLinks: jest.fn(),
}))

import { GET as getResults } from '@/app/api/members/me/nyrr-results/route'
import { POST as postLink } from '@/app/api/members/me/nyrr-link/route'
import { POST as postConfirm } from '@/app/api/members/me/nyrr-link/confirm/route'
import { requireActiveMember } from '@/lib/auth/session'
import { getMemberById, updateMemberProfile } from '@/lib/db/members'
import { getMemberResults, findRunnerCandidates, confirmRunnerLinks } from '@/lib/db/nyrr-results'

type Res = { status: number; body: any }
const get = getResults as unknown as () => Promise<Res>
const link = postLink as unknown as (req: unknown) => Promise<Res>
const confirm = postConfirm as unknown as (req: unknown) => Promise<Res>

const mockRequireActive = requireActiveMember as jest.Mock
const mockGetMember = getMemberById as jest.Mock
const mockUpdateProfile = updateMemberProfile as jest.Mock
const mockGetResults = getMemberResults as jest.Mock
const mockFindCandidates = findRunnerCandidates as jest.Mock
const mockConfirmLinks = confirmRunnerLinks as jest.Mock

const req = (body: unknown) => ({ json: () => Promise.resolve(body) }) as any
const badJsonReq = () => ({ json: () => Promise.reject(new SyntaxError('bad')) }) as any

const result = (over: object = {}) => ({
  id: 501,
  eventId: 87,
  eventName: '2026 TCS New York City Marathon',
  eventDate: '2026-11-01',
  eventUrl: null,
  distance: 'Marathon',
  bibNumber: '5967',
  finishTime: '4:11:25',
  pace: '9:36',
  overallPlace: 18275,
  genderPlace: 9000,
  ageGradePercent: 46.85,
  age: 42,
  matchMethod: 'manual',
  ...over,
})

beforeEach(() => {
  jest.clearAllMocks()
  mockRequireActive.mockResolvedValue({ memberId: 'A0042', status: 'active' })
  mockGetMember.mockResolvedValue({
    memberId: 'A0042',
    nyrrRunnerName: 'Mei Chen',
    yearBorn: 1984,
    gender: 'Female',
  })
  mockGetResults.mockResolvedValue([result()])
  mockFindCandidates.mockResolvedValue([result({ id: 777, matchMethod: null })])
  mockConfirmLinks.mockResolvedValue({ linked: 1, eventIds: [87] })
})

describe('GET /api/members/me/nyrr-results', () => {
  it('no session → 401, no DB read', async () => {
    mockRequireActive.mockRejectedValue(Object.assign(new Error('Unauthorized'), { status: 401 }))
    const res = await get()
    expect(res.status).toBe(401)
    expect(mockGetResults).not.toHaveBeenCalled()
  })

  it('non-active member → 403', async () => {
    mockRequireActive.mockRejectedValue(
      Object.assign(new Error('Active membership required'), { status: 403 })
    )
    expect((await get()).status).toBe(403)
  })

  it('queries with the session member id and nothing else', async () => {
    await get()
    expect(mockGetResults).toHaveBeenCalledWith('A0042')
    expect(mockGetResults).toHaveBeenCalledTimes(1)
  })

  it('returns results with linked=true and the profile fields', async () => {
    const res = await get()
    expect(res.status).toBe(200)
    expect(res.body.data.linked).toBe(true)
    expect(res.body.data.results).toHaveLength(1)
    expect(res.body.data.profile).toEqual({ nyrrRunnerName: 'Mei Chen', yearBorn: 1984 })
  })

  it('reports linked=false for a member with no linked rows', async () => {
    mockGetResults.mockResolvedValue([])
    const res = await get()
    expect(res.body.data.linked).toBe(false)
    expect(res.body.data.results).toEqual([])
  })

  it('tolerates a missing member record', async () => {
    mockGetMember.mockResolvedValue(null)
    mockGetResults.mockResolvedValue([])
    const res = await get()
    expect(res.status).toBe(200)
    expect(res.body.data.profile).toEqual({ nyrrRunnerName: null, yearBorn: null })
  })
})

describe('POST /api/members/me/nyrr-link', () => {
  it('saves the two matcher fields for the session member', async () => {
    const res = await link(req({ nyrrRunnerName: 'Mei Chen', yearBorn: 1984 }))
    expect(res.status).toBe(200)
    expect(mockUpdateProfile).toHaveBeenCalledWith('A0042', {
      nyrrRunnerName: 'Mei Chen',
      yearBorn: 1984,
    })
  })

  it('returns candidates WITHOUT linking them', async () => {
    // Blind-writing mmr_member_id poisons NYRRRunnerName, which then makes the
    // admin Tier-1 matcher confidently recreate the bad match.
    const res = await link(req({ nyrrRunnerName: 'Mei Chen', yearBorn: 1984 }))
    expect(res.body.data.candidates).toHaveLength(1)
    expect(mockConfirmLinks).not.toHaveBeenCalled()
  })

  it('passes the member gender to the matcher for disambiguation', async () => {
    await link(req({ nyrrRunnerName: 'Mei Chen', yearBorn: 1984 }))
    expect(mockFindCandidates).toHaveBeenCalledWith('A0042', {
      nyrrRunnerName: 'Mei Chen',
      yearBorn: 1984,
      memberGender: 'Female',
    })
  })

  it('trims the submitted name before matching', async () => {
    await link(req({ nyrrRunnerName: '  Mei Chen  ', yearBorn: 1984 }))
    expect(mockUpdateProfile).toHaveBeenCalledWith('A0042', {
      nyrrRunnerName: 'Mei Chen',
      yearBorn: 1984,
    })
  })

  it.each([
    ['missing name', { yearBorn: 1984 }],
    ['one-character name', { nyrrRunnerName: 'M', yearBorn: 1984 }],
    ['name over the varchar(100) limit', { nyrrRunnerName: 'x'.repeat(101), yearBorn: 1984 }],
    ['missing year', { nyrrRunnerName: 'Mei Chen' }],
    ['year before 1900', { nyrrRunnerName: 'Mei Chen', yearBorn: 1899 }],
    ['implausibly recent year', { nyrrRunnerName: 'Mei Chen', yearBorn: new Date().getFullYear() }],
    ['year as a string', { nyrrRunnerName: 'Mei Chen', yearBorn: '1984' }],
    ['fractional year', { nyrrRunnerName: 'Mei Chen', yearBorn: 1984.5 }],
  ])('rejects %s with 400 and writes nothing', async (_label, body) => {
    const res = await link(req(body))
    expect(res.status).toBe(400)
    expect(mockUpdateProfile).not.toHaveBeenCalled()
    expect(mockFindCandidates).not.toHaveBeenCalled()
  })

  it('rejects a malformed JSON body with 400', async () => {
    expect((await link(badJsonReq())).status).toBe(400)
  })

  it('no session → 401 and no profile write', async () => {
    mockRequireActive.mockRejectedValue(Object.assign(new Error('Unauthorized'), { status: 401 }))
    const res = await link(req({ nyrrRunnerName: 'Mei Chen', yearBorn: 1984 }))
    expect(res.status).toBe(401)
    expect(mockUpdateProfile).not.toHaveBeenCalled()
  })
})

describe('POST /api/members/me/nyrr-link/confirm', () => {
  it('links the selected rows as the session member with a member audit trail', async () => {
    const res = await confirm(req({ runnerIds: [777] }))
    expect(res.status).toBe(200)
    expect(res.body.data).toEqual({ linked: 1, requested: 1 })
    expect(mockConfirmLinks).toHaveBeenCalledWith('A0042', [777], {
      nyrrRunnerName: 'Mei Chen',
      yearBorn: 1984,
      memberGender: 'Female',
    })
  })

  it('re-derives the criteria from the DB, not from the request body', async () => {
    // Otherwise a caller could widen their own match criteria at confirm time.
    await confirm(req({ runnerIds: [777], nyrrRunnerName: 'Someone Else', yearBorn: 1900 }))
    expect(mockConfirmLinks).toHaveBeenCalledWith('A0042', [777], {
      nyrrRunnerName: 'Mei Chen',
      yearBorn: 1984,
      memberGender: 'Female',
    })
  })

  it('reports linked=0 when every id fails the server-side re-check', async () => {
    // This is the forged-id path: confirmRunnerLinks intersects with a fresh
    // candidate set, so ineligible ids simply don't get written.
    mockConfirmLinks.mockResolvedValue({ linked: 0, eventIds: [] })
    const res = await confirm(req({ runnerIds: [999999] }))
    expect(res.status).toBe(200)
    expect(res.body.data).toEqual({ linked: 0, requested: 1 })
  })

  it('409s when the profile has no NYRR name or birth year yet', async () => {
    mockGetMember.mockResolvedValue({ memberId: 'A0042', nyrrRunnerName: null, yearBorn: null })
    const res = await confirm(req({ runnerIds: [777] }))
    expect(res.status).toBe(409)
    expect(mockConfirmLinks).not.toHaveBeenCalled()
  })

  it('409s when only the birth year is missing', async () => {
    mockGetMember.mockResolvedValue({ memberId: 'A0042', nyrrRunnerName: 'Mei Chen', yearBorn: null })
    expect((await confirm(req({ runnerIds: [777] }))).status).toBe(409)
  })

  it.each([
    ['an empty list', { runnerIds: [] }],
    ['a missing list', {}],
    ['non-numeric ids', { runnerIds: ['777'] }],
    ['negative ids', { runnerIds: [-1] }],
    ['fractional ids', { runnerIds: [1.5] }],
    ['more ids than the candidate cap', { runnerIds: Array.from({ length: 51 }, (_, i) => i + 1) }],
  ])('rejects %s with 400 and writes nothing', async (_label, body) => {
    const res = await confirm(req(body))
    expect(res.status).toBe(400)
    expect(mockConfirmLinks).not.toHaveBeenCalled()
  })

  it('no session → 401 and no write', async () => {
    mockRequireActive.mockRejectedValue(Object.assign(new Error('Unauthorized'), { status: 401 }))
    const res = await confirm(req({ runnerIds: [777] }))
    expect(res.status).toBe(401)
    expect(mockConfirmLinks).not.toHaveBeenCalled()
  })
})
