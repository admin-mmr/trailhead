// ============================================================
// lib/db/polls/read.ts — poll reads: the poll itself, the tally, vote status
//
// ⚠️ Never import a *value* from this module into a client component: it pulls
// in mysql2 and the browser bundle will fail on 'net'/'tls'. `import type` is
// fine (erased at compile time). Shared literals live in lib/poll-shared.ts.
// ============================================================

import type { RowDataPacket } from 'mysql2'
import { pool } from '@/lib/db/connection'
import type { Poll, PollResults } from './types'

export async function getPollBySlug(slug: string): Promise<Poll | null> {
  const conn = await pool.getConnection()
  try {
    const [polls] = await conn.execute<RowDataPacket[]>(
      `SELECT id, slug, title_en, title_zh, description_en, description_zh,
              mode, status, results_visibility, voter_check
         FROM polls WHERE slug = ? LIMIT 1`,
      [slug]
    )
    const p = polls[0]
    if (!p) return null

    const [opts] = await conn.execute<RowDataPacket[]>(
      `SELECT id, code, label_en, label_zh, tagline_en, tagline_zh, image_path, detail_path
         FROM poll_options WHERE poll_id = ? ORDER BY sort_order, id`,
      [p.id]
    )

    return {
      id: p.id,
      slug: p.slug,
      titleEn: p.title_en,
      titleZh: p.title_zh,
      descriptionEn: p.description_en,
      descriptionZh: p.description_zh,
      mode: p.mode,
      status: p.status,
      resultsVisibility: p.results_visibility,
      voterCheck: p.voter_check,
      options: opts.map(o => ({
        id: o.id,
        code: o.code,
        labelEn: o.label_en,
        labelZh: o.label_zh,
        taglineEn: o.tagline_en,
        taglineZh: o.tagline_zh,
        imagePath: o.image_path,
        detailPath: o.detail_path,
      })),
    }
  } finally {
    conn.release()
  }
}

/**
 * Tally for a poll. Every option is returned even with zero votes, so the
 * results page never silently omits a design.
 */
export async function getPollResults(pollId: number): Promise<PollResults> {
  const conn = await pool.getConnection()
  try {
    const [rows] = await conn.execute<RowDataPacket[]>(
      `SELECT o.code, o.label_en, o.label_zh,
              COALESCE(SUM(c.rank_pos = 1), 0) AS firsts,
              COALESCE(SUM(c.rank_pos = 2), 0) AS seconds,
              COALESCE(SUM(c.rank_pos = 3), 0) AS thirds
         FROM poll_options o
         LEFT JOIN poll_ballot_choices c ON c.option_id = o.id
         LEFT JOIN poll_ballots b        ON b.id = c.ballot_id AND b.poll_id = o.poll_id
        WHERE o.poll_id = ?
        GROUP BY o.id, o.code, o.label_en, o.label_zh, o.sort_order
        ORDER BY o.sort_order, o.id`,
      [pollId]
    )

    const [countRows] = await conn.execute<RowDataPacket[]>(
      'SELECT COUNT(*) AS n FROM poll_ballots WHERE poll_id = ?',
      [pollId]
    )

    // Comments are shown verbatim on the results page but never attributed —
    // the MemberID deliberately does not leave the database.
    const [commentRows] = await conn.execute<RowDataPacket[]>(
      `SELECT comment FROM poll_ballots
        WHERE poll_id = ? AND comment IS NOT NULL AND comment <> ''
        ORDER BY created_at DESC LIMIT 200`,
      [pollId]
    )

    return {
      totalBallots: Number(countRows[0]?.n ?? 0),
      rows: rows.map(r => {
        const firsts = Number(r.firsts), seconds = Number(r.seconds), thirds = Number(r.thirds)
        return {
          code: r.code,
          labelEn: r.label_en,
          labelZh: r.label_zh,
          firsts, seconds, thirds,
          points: firsts * 3 + seconds * 2 + thirds,
        }
      }),
      comments: commentRows.map(c => String(c.comment)),
    }
  } finally {
    conn.release()
  }
}

export async function hasMemberVoted(pollId: number, memberId: string): Promise<boolean> {
  const conn = await pool.getConnection()
  try {
    const [rows] = await conn.execute<RowDataPacket[]>(
      'SELECT 1 FROM poll_ballots WHERE poll_id = ? AND MemberID = ? LIMIT 1',
      [pollId, memberId]
    )
    return rows.length > 0
  } finally {
    conn.release()
  }
}
