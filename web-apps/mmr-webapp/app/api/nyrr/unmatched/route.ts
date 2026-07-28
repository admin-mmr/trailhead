import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/auth/admin'
import { withApiHandler } from '@/lib/api-handler'
import db from '@/lib/db/connection'

export const dynamic = 'force-dynamic'

/**
 * GET /api/nyrr/unmatched
 *
 * Unmatched MMR runners across all events.
 * WHERE team_code = 'MMR' AND match_method = 'unmatched'
 * JOIN to nyrr_events for event metadata.
 * Grouped by event, ordered by event_date DESC.
 */
export const GET = withApiHandler(async (req: NextRequest) => {
  await requireAdmin()

  const [rows] = (await db.execute(
    `SELECT
      e.id as event_id,
      e.event_code,
      e.event_name,
      e.event_date,
      e.event_year,
      e.location,
      COUNT(r.id) as unmatched_count,
      GROUP_CONCAT(
        JSON_OBJECT(
          'id', r.id,
          'nyrr_runner_id', r.nyrr_runner_id,
          'runner_name', r.runner_name,
          'first_name', r.first_name,
          'last_name', r.last_name,
          'age', r.age,
          'gender', r.gender,
          'state_province', r.state_province,
          'bib_number', r.bib_number,
          'finish_time', r.finish_time
        )
      ) as runners_json
     FROM nyrr_event_runners r
     INNER JOIN nyrr_events e ON r.nyrr_event_id = e.id
     WHERE r.team_code = 'MMR' AND r.match_method = 'unmatched'
     GROUP BY e.id
     ORDER BY e.event_date DESC`
  )) as [any[], any]

  const data = (rows || []).map((row: any) => ({
    eventId: row.event_id,
    eventCode: row.event_code,
    eventName: row.event_name,
    eventDate: row.event_date,
    eventYear: row.event_year,
    location: row.location,
    unmatchedCount: row.unmatched_count,
    runners: row.runners_json
      ? JSON.parse(`[${row.runners_json}]`)
      : [],
  }))

  return NextResponse.json({ ok: true, data })
})
