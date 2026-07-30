/**
 * Unit tests for lib/db/polls.ts — the community poll service (MIGRATION_V038).
 *
 * The things worth pinning down here are the ones that would quietly corrupt a
 * tally rather than throw: a ballot that maps codes from a different poll, a
 * duplicate pick, a ballot written without its choices, and re-voting adding a
 * second ballot instead of replacing the first.
 */

jest.mock('@/lib/db/connection', () => ({
  pool: { getConnection: jest.fn() },
  getDb: jest.fn(),
}))

import { castBallot, resolveVoter, getPollResults, PollError, type Poll } from '@/lib/db/polls'
import { pool } from '@/lib/db/connection'

const mockGetConnection = (pool as unknown as { getConnection: jest.Mock }).getConnection

type Call = { sql: string; params?: unknown[] }

function makeConn(handlers: (sql: string, params?: unknown[]) => unknown = () => [[]]) {
  const calls: Call[] = []
  const conn = {
    calls,
    beginTransaction: jest.fn(async () => {}),
    commit: jest.fn(async () => {}),
    rollback: jest.fn(async () => {}),
    release: jest.fn(),
    execute: jest.fn(async (sql: string, params?: unknown[]) => {
      calls.push({ sql, params })
      return handlers(sql, params) ?? [[]]
    }),
    query: jest.fn(async (sql: string, params?: unknown[]) => {
      calls.push({ sql, params })
      return handlers(sql, params) ?? [[]]
    }),
  }
  return conn
}

const POLL: Poll = {
  id: 7,
  slug: 'website-design-2026',
  titleEn: 'Which design?',
  titleZh: null,
  descriptionEn: null,
  descriptionZh: null,
  mode: 'top3',
  status: 'open',
  resultsVisibility: 'after_vote',
  voterCheck: 'member',
  options: [
    { id: 11, code: 'a', labelEn: 'A', labelZh: null, taglineEn: null, taglineZh: null, imagePath: null, detailPath: null },
    { id: 12, code: 'b', labelEn: 'B', labelZh: null, taglineEn: null, taglineZh: null, imagePath: null, detailPath: null },
    { id: 13, code: 'c', labelEn: 'C', labelZh: null, taglineEn: null, taglineZh: null, imagePath: null, detailPath: null },
  ],
}

const ballotIdConn = () => makeConn(sql => {
  if (/SELECT id FROM poll_ballots/i.test(sql)) return [[{ id: 99 }]]
  return [{ affectedRows: 1 }]
})

afterEach(() => jest.clearAllMocks())

describe('castBallot', () => {
  it('writes one ranked choice per pick, in order, inside a transaction', async () => {
    const conn = ballotIdConn()
    mockGetConnection.mockResolvedValue(conn)

    await castBallot({ poll: POLL, memberId: 'A0001', choiceCodes: ['c', 'a', 'b'] })

    expect(conn.beginTransaction).toHaveBeenCalled()
    expect(conn.commit).toHaveBeenCalled()

    const inserts = conn.calls.filter(c => /INSERT INTO poll_ballot_choices/i.test(c.sql))
    expect(inserts).toHaveLength(3)
    // ranks follow array order, and codes map to this poll's own option ids
    expect(inserts.map(i => i.params)).toEqual([
      [99, 13, 1],
      [99, 11, 2],
      [99, 12, 3],
    ])
  })

  it('clears previous choices so re-voting replaces rather than accumulates', async () => {
    const conn = ballotIdConn()
    mockGetConnection.mockResolvedValue(conn)

    await castBallot({ poll: POLL, memberId: 'A0001', choiceCodes: ['a', 'b', 'c'] })

    const del = conn.calls.find(c => /DELETE FROM poll_ballot_choices/i.test(c.sql))
    expect(del).toBeDefined()
    expect(del!.params).toEqual([99])

    // and the envelope is an upsert, not a plain insert
    const env = conn.calls.find(c => /INSERT INTO poll_ballots/i.test(c.sql))
    expect(env!.sql).toMatch(/ON DUPLICATE KEY UPDATE/i)
  })

  it('rejects a code that is not an option in this poll, without writing', async () => {
    const conn = ballotIdConn()
    mockGetConnection.mockResolvedValue(conn)

    await expect(
      castBallot({ poll: POLL, memberId: 'A0001', choiceCodes: ['a', 'b', 'zzz'] })
    ).rejects.toThrow(PollError)

    expect(conn.beginTransaction).not.toHaveBeenCalled()
    expect(conn.calls.filter(c => /INSERT INTO/i.test(c.sql))).toHaveLength(0)
  })

  it('rejects the same option ranked twice', async () => {
    mockGetConnection.mockResolvedValue(ballotIdConn())
    await expect(
      castBallot({ poll: POLL, memberId: 'A0001', choiceCodes: ['a', 'a', 'b'] })
    ).rejects.toThrow(/only be chosen once/i)
  })

  it('rejects the wrong number of picks for the poll mode', async () => {
    mockGetConnection.mockResolvedValue(ballotIdConn())
    await expect(
      castBallot({ poll: POLL, memberId: 'A0001', choiceCodes: ['a', 'b'] })
    ).rejects.toThrow(/exactly 3/i)

    await expect(
      castBallot({ poll: { ...POLL, mode: 'single' }, memberId: 'A0001', choiceCodes: ['a', 'b'] })
    ).rejects.toThrow(/one design/i)
  })

  it('refuses to record a vote on a poll that is not open', async () => {
    mockGetConnection.mockResolvedValue(ballotIdConn())
    for (const status of ['draft', 'closed'] as const) {
      await expect(
        castBallot({ poll: { ...POLL, status }, memberId: 'A0001', choiceCodes: ['a', 'b', 'c'] })
      ).rejects.toThrow(/not open/i)
    }
  })

  it('requires a member id when the poll checks membership', async () => {
    mockGetConnection.mockResolvedValue(ballotIdConn())
    await expect(
      castBallot({ poll: POLL, memberId: null, choiceCodes: ['a', 'b', 'c'] })
    ).rejects.toThrow(/member ID/i)
  })

  it('rolls back if a choice insert fails, so no ballot survives without choices', async () => {
    const conn = makeConn(sql => {
      if (/SELECT id FROM poll_ballots/i.test(sql)) return [[{ id: 99 }]]
      if (/INSERT INTO poll_ballot_choices/i.test(sql)) throw new Error('duplicate rank')
      return [{ affectedRows: 1 }]
    })
    mockGetConnection.mockResolvedValue(conn)

    await expect(
      castBallot({ poll: POLL, memberId: 'A0001', choiceCodes: ['a', 'b', 'c'] })
    ).rejects.toThrow('duplicate rank')

    expect(conn.rollback).toHaveBeenCalled()
    expect(conn.commit).not.toHaveBeenCalled()
    expect(conn.release).toHaveBeenCalled()
  })
})

describe('resolveVoter', () => {
  it('uppercases and trims the member id but never wraps the column in a function', async () => {
    const conn = makeConn(sql =>
      /FROM members/i.test(sql) ? [[{ MemberID: 'A0042' }]] : [[]]
    )
    mockGetConnection.mockResolvedValue(conn)

    const id = await resolveVoter('  a0042 ', '  Chen  ')
    expect(id).toBe('A0042')

    const q = conn.calls.find(c => /FROM members/i.test(c.sql))!
    expect(q.params).toEqual(['A0042', 'Chen'])
    // LOWER()/TRIM() on an indexed column drops the index — must stay absent
    expect(q.sql).not.toMatch(/LOWER\s*\(|TRIM\s*\(/i)
  })

  it('gives the same message for a wrong name as for an unknown id', async () => {
    mockGetConnection.mockResolvedValue(makeConn(() => [[]]))
    await expect(resolveVoter('A0042', 'Wrong')).rejects.toThrow(/could not match/i)
    await expect(resolveVoter('A9999', 'Chen')).rejects.toThrow(/could not match/i)
  })

  it('rejects blank input before touching the database', async () => {
    const conn = makeConn(() => [[]])
    mockGetConnection.mockResolvedValue(conn)
    await expect(resolveVoter('   ', 'Chen')).rejects.toThrow(/both/i)
    expect(conn.execute).not.toHaveBeenCalled()
  })
})

describe('getPollResults', () => {
  it('weights first choices highest and never drops a zero-vote option', async () => {
    const conn = makeConn(sql => {
      if (/FROM poll_options/i.test(sql)) {
        return [[
          { code: 'a', label_en: 'A', label_zh: null, firsts: 2, seconds: 1, thirds: 0 },
          { code: 'b', label_en: 'B', label_zh: null, firsts: 0, seconds: 0, thirds: 0 },
        ]]
      }
      if (/COUNT\(\*\)/i.test(sql)) return [[{ n: 3 }]]
      return [[]]
    })
    mockGetConnection.mockResolvedValue(conn)

    const res = await getPollResults(7)
    expect(res.totalBallots).toBe(3)
    expect(res.rows).toHaveLength(2)
    expect(res.rows[0]).toMatchObject({ code: 'a', points: 2 * 3 + 1 * 2 })
    expect(res.rows[1]).toMatchObject({ code: 'b', points: 0 })
  })

  it('returns comments without any member identifier attached', async () => {
    const conn = makeConn(sql => {
      if (/FROM poll_options/i.test(sql)) return [[]]
      if (/COUNT\(\*\)/i.test(sql)) return [[{ n: 1 }]]
      if (/comment FROM poll_ballots/i.test(sql)) return [[{ comment: 'love option C' }]]
      return [[]]
    })
    mockGetConnection.mockResolvedValue(conn)

    const res = await getPollResults(7)
    expect(res.comments).toEqual(['love option C'])

    const q = conn.calls.find(c => /comment FROM poll_ballots/i.test(c.sql))!
    expect(q.sql).not.toMatch(/MemberID/)
  })
})
