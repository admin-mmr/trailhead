// ============================================================
// lib/db/polls/vote.ts — identifying a voter and recording a ballot
//
// ⚠️ Never import a *value* from this module into a client component: it pulls
// in mysql2 and the browser bundle will fail on 'net'/'tls'. `import type` is
// fine (erased at compile time). Shared literals live in lib/poll-shared.ts.
// ============================================================

import type { RowDataPacket, ResultSetHeader } from 'mysql2'
import { pool } from '@/lib/db/connection'
import { MAX_COMMENT_LEN, RANKS_FOR_MODE } from '@/lib/poll-shared'
import { PollError, type CastBallotInput } from './types'

/**
 * Resolve MemberID + last name to a canonical MemberID.
 *
 * Compared with `=` rather than LOWER()/TRIM() on the column: `members` is
 * utf8mb4_unicode_ci so it is already case-insensitive, and wrapping an indexed
 * column in a function drops the index. Input is trimmed in JS instead.
 *
 * Any mismatch returns the same message, so this cannot be used to enumerate
 * which MemberIDs exist.
 */
export async function resolveVoter(memberIdRaw: string, lastNameRaw: string): Promise<string> {
  const memberId = memberIdRaw.trim().toUpperCase()
  const lastName = lastNameRaw.trim()
  if (!memberId || !lastName) {
    throw new PollError(400, 'Enter both your member ID and your last name.')
  }

  const conn = await pool.getConnection()
  try {
    const [rows] = await conn.execute<RowDataPacket[]>(
      'SELECT MemberID FROM members WHERE MemberID = ? AND LastName = ? LIMIT 1',
      [memberId, lastName]
    )
    if (!rows.length) {
      throw new PollError(404, 'We could not match that member ID and last name. Please check both and try again.')
    }
    return String(rows[0].MemberID)
  } finally {
    conn.release()
  }
}

/**
 * Validate a ballot against the poll it claims to belong to.
 * Returns the option ids in rank order. Throws PollError on anything a caller
 * should see as a 4xx; runs before any transaction opens so a rejected ballot
 * never touches the database.
 */
function validateBallot(input: CastBallotInput): { optionIds: number[]; comment: string | null } {
  const { poll, memberId, comment } = input

  if (poll.status !== 'open') {
    throw new PollError(409, 'This poll is not open for voting.')
  }

  const expected = RANKS_FOR_MODE[poll.mode]
  const codes = input.choiceCodes.map(c => String(c ?? '').trim()).filter(Boolean)

  if (codes.length !== expected) {
    throw new PollError(400, expected === 1
      ? 'Choose one design.'
      : `Choose exactly ${expected} designs, in order.`)
  }
  if (new Set(codes).size !== codes.length) {
    throw new PollError(400, 'Each design may only be chosen once.')
  }
  if (poll.voterCheck === 'member' && !memberId) {
    throw new PollError(400, 'This poll requires a member ID.')
  }

  // Map codes to ids against this poll's own options, so a code from another
  // poll (or an invented one) cannot be recorded.
  const byCode = new Map(poll.options.map(o => [o.code, o.id]))
  const optionIds = codes.map(code => {
    const id = byCode.get(code)
    if (id == null) throw new PollError(400, 'That is not one of the designs in this poll.')
    return id
  })

  return {
    optionIds,
    comment: comment?.trim() ? comment.trim().slice(0, MAX_COMMENT_LEN) : null,
  }
}

/**
 * Record a ballot. Runs in one transaction so a ballot never exists without
 * its choices. Re-voting replaces the previous ballot rather than adding one:
 * the choices are deleted and re-inserted under the same ballot row.
 */
export async function castBallot(input: CastBallotInput): Promise<void> {
  const { poll, memberId, ipHash } = input
  const { optionIds, comment } = validateBallot(input)

  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()

    let ballotId: number

    if (memberId) {
      // One ballot per member: insert, or take over the existing row.
      await conn.execute<ResultSetHeader>(
        `INSERT INTO poll_ballots (poll_id, MemberID, comment, ip_hash)
              VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE comment = ?, ip_hash = ?`,
        [poll.id, memberId, comment, ipHash ?? null, comment, ipHash ?? null]
      )
      // insertId is unreliable after ON DUPLICATE KEY UPDATE, so read the row
      // back. Safe here because (poll_id, MemberID) identifies exactly one row.
      const [rows] = await conn.execute<RowDataPacket[]>(
        'SELECT id FROM poll_ballots WHERE poll_id = ? AND MemberID = ? LIMIT 1',
        [poll.id, memberId]
      )
      ballotId = Number(rows[0]?.id)
    } else {
      // Anonymous ('open') poll: MemberID is NULL and NULLs are distinct in a
      // UNIQUE index, so there is nothing to upsert onto. Use the insert's own
      // id — reading back "the newest ballot" would race with concurrent
      // voters and could attach these choices to someone else's ballot.
      const [res] = await conn.execute<ResultSetHeader>(
        `INSERT INTO poll_ballots (poll_id, MemberID, comment, ip_hash) VALUES (?, NULL, ?, ?)`,
        [poll.id, comment, ipHash ?? null]
      )
      ballotId = Number(res.insertId)
    }

    if (!ballotId) throw new Error('ballot row missing after insert')

    await conn.execute('DELETE FROM poll_ballot_choices WHERE ballot_id = ?', [ballotId])

    for (let i = 0; i < optionIds.length; i++) {
      await conn.execute(
        'INSERT INTO poll_ballot_choices (ballot_id, option_id, rank_pos) VALUES (?, ?, ?)',
        [ballotId, optionIds[i], i + 1]
      )
    }

    await conn.commit()
  } catch (err) {
    await conn.rollback().catch(() => {})
    throw err
  } finally {
    conn.release()
  }
}
