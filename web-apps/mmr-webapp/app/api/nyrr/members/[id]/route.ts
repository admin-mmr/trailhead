import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/auth/admin'
import { withApiHandler } from '@/lib/api-handler'
import db from '@/lib/db/connection'

export const dynamic = 'force-dynamic'

/**
 * GET /api/nyrr/members/[id]
 *
 * Fetch member profile data including:
 * - Member info: MemberID, FirstName, LastName, Email, NYRRRunnerName, YearBorn, YearBornGuess, Gender, Status
 * - Race history: all nyrr_event_runners rows WHERE mmr_member_id = [id], JOINed with nyrr_events for event name/date/distance
 */
export const GET = withApiHandler(async (
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) => {
  await requireAdmin()

  const { id } = await params

  // Get member info
  const [memberRows] = (await db.execute(
    `SELECT MemberID, FirstName, LastName, Email, NYRRRunnerName, YearBorn, YearBornGuess, Gender, Status
     FROM members WHERE MemberID = ? LIMIT 1`,
    [id]
  )) as [any[], any]

  if (!memberRows.length) {
    return NextResponse.json({ error: 'Member not found' }, { status: 404 })
  }

  // Get race history
  const [races] = (await db.execute(
    `SELECT r.id, r.nyrr_runner_id, r.runner_name, r.bib_number, r.finish_time, r.pace,
            r.overall_place, r.gender_place, r.age, r.gender, r.match_method,
            e.event_name, e.event_date, e.distance, e.event_code, e.id as event_id
     FROM nyrr_event_runners r
     JOIN nyrr_events e ON r.nyrr_event_id = e.id
     WHERE r.mmr_member_id = ?
     ORDER BY e.event_date DESC`,
    [id]
  )) as [any[], any]

  return NextResponse.json({
    ok: true,
    data: {
      member: memberRows[0],
      races,
    },
  })
})
