import { NextRequest, NextResponse } from 'next/server'
import { requireSession } from '@/lib/auth/session'
import { isAdmin } from '@/lib/db/admins'
import db from '@/lib/db/connection'

export const dynamic = 'force-dynamic'

/**
 * DELETE /api/nyrr/match/[id]
 *
 * Unlink a match.
 * Query param: ?clearName=true to optionally clear NYRRRunnerName on the member
 *
 * Steps:
 * 1. Clear mmr_member_id, match_method='unmatched', matched_by=NULL, matched_at=NULL on the runner
 * 2. Optionally clear NYRRRunnerName on the member (if clearName=true)
 * 3. Update mmr_matched_count on the affected nyrr_events row
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const connection = await db.getConnection()
  try {
    const session = await requireSession()
    if (!(await isAdmin(session.email))) {
      await connection.release()
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const runnerId = parseInt(params.id)
    if (isNaN(runnerId)) {
      await connection.release()
      return NextResponse.json({ error: 'Invalid runner ID' }, { status: 400 })
    }

    const clearName =
      req.nextUrl.searchParams.get('clearName')?.toLowerCase() === 'true'

    await connection.beginTransaction()

    try {
      // Get the runner record first
      const [runnerRows] = (await connection.execute(
        `SELECT mmr_member_id, nyrr_event_id FROM nyrr_event_runners WHERE id = ?`,
        [runnerId]
      )) as [any[], any]

      if (!runnerRows || runnerRows.length === 0) {
        throw new Error('Runner not found')
      }

      const runner = runnerRows[0]
      const memberId = runner.mmr_member_id
      const eventId = runner.nyrr_event_id

      // 1. Clear the match on the runner
      await connection.execute(
        `UPDATE nyrr_event_runners
         SET mmr_member_id = NULL, match_method = 'unmatched', matched_by = NULL, matched_at = NULL
         WHERE id = ?`,
        [runnerId]
      )

      // 2. Optionally clear NYRRRunnerName on the member
      if (clearName && memberId) {
        await connection.execute(
          `UPDATE members SET NYRRRunnerName = NULL WHERE MemberID = ?`,
          [memberId]
        )
      }

      // 3. Update mmr_matched_count on the affected event
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

      await connection.commit()

      return NextResponse.json({
        ok: true,
        message: `Match unlinked for runner ${runnerId}.${clearName ? ' Member name cleared.' : ''}`,
      })
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
    console.error('[api/nyrr/match/[id]] DELETE error:', err)
    await connection.release()
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
