import { NextResponse } from 'next/server'
import { requireSession } from '@/lib/auth/session'
import { isAdmin } from '@/lib/db/admins'
import db from '@/lib/db/connection'

export const dynamic = 'force-dynamic'

/**
 * GET /api/nyrr/stats
 *
 * Dashboard summary stats for NYRR data:
 * - Total events count
 * - Upcoming events count
 * - Total MMR runners (sum of mmr_runner_count)
 * - Unmatched queue size (count of nyrr_event_runners WHERE team_code='MMR' AND match_method='unmatched')
 * - Processing status breakdown (count per status)
 */
export async function GET() {
  try {
    const session = await requireSession()
    if (!(await isAdmin(session.email))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Total events
    const [totalEventsRows] = (await db.execute(
      `SELECT COUNT(*) as count FROM nyrr_events`
    )) as [any[], any]
    const totalEvents = totalEventsRows[0]?.count ?? 0

    // Upcoming events
    const [upcomingRows] = (await db.execute(
      `SELECT COUNT(*) as count FROM nyrr_events WHERE is_upcoming = TRUE`
    )) as [any[], any]
    const upcomingEvents = upcomingRows[0]?.count ?? 0

    // Total MMR runners
    const [mrrRows] = (await db.execute(
      `SELECT COALESCE(SUM(mmr_runner_count), 0) as total FROM nyrr_events`
    )) as [any[], any]
    const totalMmrRunners = mrrRows[0]?.total ?? 0

    // Unmatched queue size
    const [unmatchedRows] = (await db.execute(
      `SELECT COUNT(*) as count FROM nyrr_event_runners
       WHERE team_code = 'MMR' AND match_method = 'unmatched'`
    )) as [any[], any]
    const unmatchedQueueSize = unmatchedRows[0]?.count ?? 0

    // Processing status breakdown
    const [statusRows] = (await db.execute(
      `SELECT processing_status, COUNT(*) as count
       FROM nyrr_events
       GROUP BY processing_status`
    )) as [any[], any]
    const statusBreakdown = (statusRows || []).reduce((acc: any, row: any) => {
      acc[row.processing_status || 'Unknown'] = row.count
      return acc
    }, {})

    return NextResponse.json({
      ok: true,
      data: {
        totalEvents,
        upcomingEvents,
        totalMmrRunners,
        unmatchedQueueSize,
        statusBreakdown,
      },
    })
  } catch (err: any) {
    if (err.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('[api/nyrr/stats] GET error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
