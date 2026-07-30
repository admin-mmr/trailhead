/**
 * Unit tests for lib/db/nyrr-results.ts
 *
 * confirmRunnerLinks() is the actual security boundary for self-service linking:
 * `runnerIds` arrives from the browser, so an id that isn't in the freshly
 * computed candidate set must never be written. The route tests mock this
 * function, so it gets exercised for real here.
 *
 * Also pins the query shape, because two details are load-bearing and invisible:
 * name comparisons must NOT wrap the column in LOWER()/TRIM() (that turns a
 * 6-row index lookup into a 1.6M-row scan — measured against prod), and the age
 * check must use the EVENT year, not the current year.
 */

jest.mock('@/lib/db/connection', () => ({
  __esModule: true,
  default: { execute: jest.fn(), getConnection: jest.fn() },
  pool: { getConnection: jest.fn() },
  getDb: jest.fn(),
}))

import {
  AGE_TOLERANCE,
  MAX_CANDIDATES,
  confirmRunnerLinks,
  findRunnerCandidates,
  getMemberResults,
} from '@/lib/db/nyrr-results'
import db from '@/lib/db/connection'

const mockExecute = db.execute as unknown as jest.Mock

const row = (over: Record<string, unknown> = {}) => ({
  id: 777,
  event_id: 87,
  event_name: 'NYRR Cross Country Series #3',
  event_date: '2025-11-16',
  event_url: null,
  distance: '5K',
  bib_number: '123',
  finish_time: '0:22:10',
  pace: '7:08',
  overall_place: 400,
  gender_place: 200,
  age_grade_percent: '61.20',
  age: 30,
  match_method: null,
  ...over,
})

const CRITERIA = { nyrrRunnerName: 'Declan Dwyer-Mcnulty', yearBorn: 1995, memberGender: 'Male' }

beforeEach(() => jest.clearAllMocks())

describe('getMemberResults', () => {
  it('scopes to the member and formats the date in SQL', async () => {
    mockExecute.mockResolvedValueOnce([[row()]])
    const results = await getMemberResults('A0042')

    const [sql, params] = mockExecute.mock.calls[0]
    expect(params).toEqual(['A0042'])
    expect(sql).toContain('ner.mmr_member_id = ?')
    // A driver Date would JSON-serialize to a UTC instant and render a day early.
    expect(sql).toContain("DATE_FORMAT(ne.event_date, '%Y-%m-%d')")
    expect(results[0].eventDate).toBe('2025-11-16')
  })

  it('converts the DECIMAL age grade to a number', async () => {
    mockExecute.mockResolvedValueOnce([[row({ age_grade_percent: '61.20' })]])
    const [r] = await getMemberResults('A0042')
    expect(r.ageGradePercent).toBe(61.2)
    expect(typeof r.ageGradePercent).toBe('number')
  })

  it('maps a NULL age grade to null, not NaN', async () => {
    mockExecute.mockResolvedValueOnce([[row({ age_grade_percent: null })]])
    const [r] = await getMemberResults('A0042')
    expect(r.ageGradePercent).toBeNull()
  })
})

describe('findRunnerCandidates — query shape', () => {
  beforeEach(() => mockExecute.mockResolvedValue([[row()]]))

  it('compares names with plain equality so the index is usable', async () => {
    await findRunnerCandidates('A0042', CRITERIA)
    const [sql] = mockExecute.mock.calls[0]
    expect(sql).toContain('ner.runner_name = ?')
    expect(sql).not.toMatch(/LOWER\(\s*TRIM\(\s*ner\./i)
    expect(sql).not.toMatch(/LOWER\(\s*ner\.runner_name/i)
  })

  it('checks age against the EVENT year, not the current year', async () => {
    await findRunnerCandidates('A0042', CRITERIA)
    const [sql] = mockExecute.mock.calls[0]
    expect(sql).toContain('ne.event_year')
    expect(sql).not.toContain('CURDATE()')
    expect(sql).not.toContain('YEAR(NOW())')
  })

  it('only considers rows that are unlinked or already this member’s', async () => {
    await findRunnerCandidates('A0042', CRITERIA)
    const [sql, params] = mockExecute.mock.calls[0]
    expect(sql).toContain('ner.mmr_member_id IS NULL OR ner.mmr_member_id = ?')
    expect(params[0]).toBe('A0042')
  })

  it('splits a full name into first and last for the secondary match', async () => {
    await findRunnerCandidates('A0042', CRITERIA)
    const [, params] = mockExecute.mock.calls[0]
    expect(params).toContain('Declan')
    expect(params).toContain('Dwyer-Mcnulty')
  })

  it('passes NULL first/last for a single-token name so that branch is inert', async () => {
    await findRunnerCandidates('A0042', { ...CRITERIA, nyrrRunnerName: 'Prince' })
    const [, params] = mockExecute.mock.calls[0]
    // params: [memberId, fullName, first, first, last, yearBorn, tol, gender, gender]
    expect(params[2]).toBeNull()
    expect(params[4]).toBeNull()
  })

  it('trims the input name rather than the column', async () => {
    await findRunnerCandidates('A0042', { ...CRITERIA, nyrrRunnerName: '  Mei Chen  ' })
    const [, params] = mockExecute.mock.calls[0]
    expect(params[1]).toBe('Mei Chen')
  })

  it('passes the age tolerance and birth year as parameters', async () => {
    await findRunnerCandidates('A0042', CRITERIA)
    const [, params] = mockExecute.mock.calls[0]
    expect(params).toContain(1995)
    expect(params).toContain(AGE_TOLERANCE)
  })

  it('caps the result set', async () => {
    await findRunnerCandidates('A0042', CRITERIA)
    const [sql] = mockExecute.mock.calls[0]
    expect(sql).toContain(`LIMIT ${MAX_CANDIDATES}`)
  })

  it.each([
    ['Male', 'Male'],
    ['Female', 'Female'],
    ['Other', 'Other'],
  ])('filters on gender %s', async (input, expected) => {
    await findRunnerCandidates('A0042', { ...CRITERIA, memberGender: input })
    const [, params] = mockExecute.mock.calls[0]
    expect(params[7]).toBe(expected)
  })

  it.each([null, undefined, '', '   ', 'Non-binary', 'Prefer not to say'])(
    'does not filter on an unusable gender (%p)',
    async (gender) => {
      await findRunnerCandidates('A0042', { ...CRITERIA, memberGender: gender as string | null })
      const [, params] = mockExecute.mock.calls[0]
      expect(params[7]).toBeNull()
    }
  )

  it('normalizes NYRR M/W/X in SQL rather than in JS', async () => {
    await findRunnerCandidates('A0042', CRITERIA)
    const [sql] = mockExecute.mock.calls[0]
    expect(sql).toContain("WHEN 'M' THEN 'Male'")
    expect(sql).toContain("WHEN 'W' THEN 'Female'")
    expect(sql).toContain("WHEN 'X' THEN 'Other'")
    // Empty string is a real value in this column, distinct from NULL.
    expect(sql).toContain("ner.gender = ''")
  })
})

describe('confirmRunnerLinks — the untrusted-id boundary', () => {
  /** First execute() answers the candidate query; later ones are the writes. */
  function mockCandidates(rows: Record<string, unknown>[]) {
    mockExecute.mockReset()
    mockExecute
      .mockResolvedValueOnce([rows])                 // findRunnerCandidates
      .mockResolvedValueOnce([{ affectedRows: rows.length }]) // UPDATE runners
      .mockResolvedValueOnce([{ affectedRows: 1 }])   // refresh matched counts
  }

  it('links an id that is in the candidate set', async () => {
    mockCandidates([row({ id: 777 })])
    const res = await confirmRunnerLinks('A0042', [777], CRITERIA)

    expect(res.linked).toBe(1)
    const [sql, params] = mockExecute.mock.calls[1]
    expect(sql).toContain("match_method = 'manual'")
    expect(params[0]).toBe('A0042')
    expect(params[1]).toBe('member:A0042')
    expect(params).toContain(777)
  })

  it('drops a forged id that is NOT in the candidate set, without any write', async () => {
    mockCandidates([row({ id: 777 })])
    const res = await confirmRunnerLinks('A0042', [999999], CRITERIA)

    expect(res.linked).toBe(0)
    expect(res.eventIds).toEqual([])
    // Only the candidate SELECT ran — no UPDATE was issued at all.
    expect(mockExecute).toHaveBeenCalledTimes(1)
  })

  it('links only the eligible subset of a mixed request', async () => {
    mockCandidates([row({ id: 777 }), row({ id: 778 })])
    await confirmRunnerLinks('A0042', [777, 999999], CRITERIA)

    const [, params] = mockExecute.mock.calls[1]
    expect(params).toContain(777)
    expect(params).not.toContain(999999)
  })

  it('re-asserts the ownership guard in the UPDATE itself', async () => {
    // Belt-and-suspenders against a row being claimed between SELECT and UPDATE.
    mockCandidates([row({ id: 777 })])
    await confirmRunnerLinks('A0042', [777], CRITERIA)
    const [sql] = mockExecute.mock.calls[1]
    expect(sql).toContain('mmr_member_id IS NULL OR mmr_member_id = ?')
  })

  it('stamps matched_at so the audit trail has a time', async () => {
    mockCandidates([row({ id: 777 })])
    await confirmRunnerLinks('A0042', [777], CRITERIA)
    expect(mockExecute.mock.calls[1][0]).toContain('matched_at = NOW()')
  })

  it('refreshes nyrr_events.mmr_matched_count for affected events', async () => {
    // Otherwise the admin dashboards drift on every self-service link.
    mockCandidates([row({ id: 777, event_id: 87 })])
    await confirmRunnerLinks('A0042', [777], CRITERIA)

    const [sql, params] = mockExecute.mock.calls[2]
    expect(sql).toContain('mmr_matched_count')
    expect(params).toEqual([87])
  })

  it('does nothing when the candidate set is empty', async () => {
    mockExecute.mockReset()
    mockExecute.mockResolvedValueOnce([[]])
    const res = await confirmRunnerLinks('A0042', [777], CRITERIA)
    expect(res).toEqual({ linked: 0, eventIds: [] })
    expect(mockExecute).toHaveBeenCalledTimes(1)
  })

  it('deduplicates event ids before refreshing counts', async () => {
    mockCandidates([row({ id: 777, event_id: 87 }), row({ id: 778, event_id: 87 })])
    await confirmRunnerLinks('A0042', [777, 778], CRITERIA)
    expect(mockExecute.mock.calls[2][1]).toEqual([87])
  })
})
