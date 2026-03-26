import { NextRequest, NextResponse } from 'next/server'
import { requireSession } from '@/lib/auth/session'
import { isAdmin } from '@/lib/db/admins'
import db from '@/lib/db/connection'

export const dynamic = 'force-dynamic'

/**
 * PATCH /api/nyrr/members/[id]/edit-name
 *
 * Edit member NYRRRunnerName.
 * Body: { nyrrRunnerName: string }
 *
 * Steps:
 * 1. Update members SET NYRRRunnerName = ?
 * 2. Backfill: find all nyrr_event_runners with matching runner_name and set mmr_member_id
 * 3. Update dashboard counters (mmr_matched_count on affected events)
 */
export async function PATCH(
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

    const memberId = params.id
    if (!memberId || typeof memberId !== 'string') {
      await connection.release()
      return NextResponse.json({ error: 'Invalid member ID' }, { status: 400 })
    }

    const { nyrrRunnerName } = await req.json()
    if (nyrrRunnerName === undefined || nyrrRunnerName === null) {
      await connection.release()
      return NextResponse.json(
        { error: 'nyrrRunnerName is required' },
        { status: 400 }
      )
    }

    const nameValue = typeof nyrrRunnerName === 'string' ? nyrrRunnerName : null

    await connection.beginTransaction()

    try {
      // 1. Update member NYRRRunnerName
      await connection.execute(
        `UPDATE members SET NYRRRunnerName = ? WHERE MemberID = ?`,
        [nameValue, memberId]
      )

      // 2. If name is provided, backfill matching runners
      if (nameValue && nameValue.trim().length > 0) {
        // Find all unmatched runners with this exact name
        const [unmatchedRunners] = (await connection.execute(
          `SELECT DISTINCT nyrr_event_id FROM nyrr_event_runners
           WHERE runner_name = ? AND mmr_member_id IS NULL`,
          [nameValue]
        )) as [any[], any]

        // Update them with this member
        await connection.execute(
          `UPDATE nyrr_event_runners
           SET mmr_member_id = ?, match_method = 'auto_name', matched_by = ?, matched_at = NOW()
           WHERE runner_name = ? AND mmr_member_id IS NULL`,
          [memberId, session.email, nameValue]
        )

        // 3. Update counters on affected events
        for (const row of unmatchedRunners || []) {
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
      }

      await connection.commit()

      return NextResponse.json({
        ok: true,
        message: `Member ${memberId} NYRRRunnerName updated to "${nameValue}".`,
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
    console.error('[api/nyrr/members/[id]/edit-name] PATCH error:', err)
    await connection.release()
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
