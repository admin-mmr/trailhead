import { NextRequest, NextResponse } from 'next/server'
import { requireSession } from '@/lib/auth/session'
import { isAdmin } from '@/lib/db/admins'
import db from '@/lib/db/connection'

export const dynamic = 'force-dynamic'

/**
 * POST /api/nyrr/match
 *
 * Confirm a runner-to-member match.
 * Body: { runnerId: number, memberId: string, matchMethod?: 'manual' }
 *
 * Steps:
 * 1. Update nyrr_event_runners SET mmr_member_id, match_method='manual', matched_by=session.email, matched_at=NOW()
 * 2. Get the runner_name from the runner record
 * 3. Write NYRRRunnerName to the member
 * 4. Backfill: UPDATE all nyrr_event_runners WHERE runner_name = ? AND mmr_member_id IS NULL SET mmr_member_id, match_method='auto_name'
 * 5. Update mmr_matched_count on affected nyrr_events rows
 */
export async function POST(req: NextRequest) {
  const connection = await db.getConnection()
  try {
    const session = await requireSession()
    if (!(await isAdmin(session.email))) {
      await connection.release()
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { runnerId, memberId, matchMethod } = await req.json()

    if (!runnerId || !memberId) {
      await connection.release()
      return NextResponse.json(
        { error: 'runnerId and memberId are required' },
        { status: 400 }
      )
    }

    await connection.beginTransaction()

    try {
      // 1. Get the runner record first
      const [runnerRows] = (await connection.execute(
        `SELECT runner_name, nyrr_event_id FROM nyrr_event_runners WHERE id = ?`,
        [runnerId]
      )) as [any[], any]

      if (!runnerRows || runnerRows.length === 0) {
        throw new Error('Runner not found')
      }

      const runner = runnerRows[0]
      const runnerName = runner.runner_name
      const nyrr_event_id = runner.nyrr_event_id

      // 2. Update the specific runner with manual match
      await connection.execute(
        `UPDATE nyrr_event_runners
         SET mmr_member_id = ?, match_method = 'manual', matched_by = ?, matched_at = NOW()
         WHERE id = ?`,
        [memberId, session.email, runnerId]
      )

      // 3. Write NYRRRunnerName to the member
      await connection.execute(
        `UPDATE members SET NYRRRunnerName = ? WHERE MemberID = ?`,
        [runnerName, memberId]
      )

      // 4. Backfill: match all unmatched runners with the same name
      await connection.execute(
        `UPDATE nyrr_event_runners
         SET mmr_member_id = ?, match_method = 'auto_name', matched_by = ?, matched_at = NOW()
         WHERE runner_name = ? AND mmr_member_id IS NULL`,
        [memberId, session.email, runnerName]
      )

      // 5. Update mmr_matched_count on affected nyrr_events
      // Get all affected event IDs
      const [affectedEventsRows] = (await connection.execute(
        `SELECT DISTINCT nyrr_event_id FROM nyrr_event_runners WHERE runner_name = ? AND mmr_member_id = ?`,
        [runnerName, memberId]
      )) as [any[], any]

      for (const row of affectedEventsRows || []) {
        const eventId = row.nyrr_event_id
        const [matchCountRows] = (await connection.execute(
          `SELECT COUNT(*) as count FROM nyrr_event_runners
           WHERE nyrr_event_id = ? AND mmr_member_id IS NOT NULL`,
          [eventId]
        )) as [any[], any]

        const matchCount = matchCountRows[0]?.count ?? 0
        await connection.execute(
          `UPDATE nyrr_events SET mmr_matched_count = ? WHERE id = ?`,
          [matchCount, eventId]
        )
      }

      await connection.commit()

      return NextResponse.json(
        {
          ok: true,
          message: `Runner matched to member ${memberId}. Backfilled ${affectedEventsRows.length - 1} additional matches.`,
        },
        { status: 201 }
      )
    } catch (txnErr) {
      await connection.rollback()
      throw txnErr
    }
  } catch (err: any) {
    if (err.message === 'Unauthorized') {
      await connection.release()
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (err.message === 'Runner not found') {
      await connection.release()
      return NextResponse.json({ error: 'Runner not found' }, { status: 404 })
    }
    console.error('[api/nyrr/match] POST error:', err)
    await connection.release()
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
