import { NextRequest, NextResponse } from 'next/server'
import { requireSession } from '@/lib/auth/session'
import { isAdmin } from '@/lib/db/admins'
import db from '@/lib/db/connection'

export const dynamic = 'force-dynamic'

/**
 * GET /api/nyrr/events/[id]/runners
 *
 * Paginated runner list for an event.
 * Query params:
 * - cursor: pagination cursor (lastId)
 * - limit: default 50
 * - filter: all/mmr/matched/unmatched/not_member
 *
 * LEFT JOIN to members to get member name for matched runners.
 * Sort by last_name ASC default.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await requireSession()
    if (!(await isAdmin(session.email))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const eventId = parseInt(params.id)
    if (isNaN(eventId)) {
      return NextResponse.json({ error: 'Invalid event ID' }, { status: 400 })
    }

    const cursor = req.nextUrl.searchParams.get('cursor')
    const limit = Math.min(
      parseInt(req.nextUrl.searchParams.get('limit') ?? '50'),
      200
    )
    const filter = req.nextUrl.searchParams.get('filter') ?? 'all'

    let query = `
      SELECT
        r.id,
        r.nyrr_event_id,
        r.nyrr_runner_id,
        r.runner_name,
        r.first_name,
        r.last_name,
        r.age,
        r.gender,
        r.state_province,
        r.bib_number,
        r.finish_time,
        r.pace,
        r.overall_place,
        r.gender_place,
        r.team_code,
        r.is_registered_only,
        r.mmr_member_id,
        r.match_method,
        r.matched_by,
        r.matched_at,
        r.scan_timestamp,
        r.created_at,
        r.updated_at,
        m.FirstName as member_first_name,
        m.LastName as member_last_name,
        m.Email as member_email
      FROM nyrr_event_runners r
      LEFT JOIN members m ON r.mmr_member_id = m.MemberID
      WHERE r.nyrr_event_id = ?
    `
    const queryParams: any[] = [eventId]

    // Apply filter
    if (filter === 'mmr') {
      query += ` AND r.team_code = 'MMR'`
    } else if (filter === 'matched') {
      query += ` AND r.mmr_member_id IS NOT NULL`
    } else if (filter === 'unmatched') {
      query += ` AND r.team_code = 'MMR' AND r.match_method = 'unmatched'`
    } else if (filter === 'not_member') {
      query += ` AND r.match_method = 'not_member'`
    }

    if (cursor) {
      query += ` AND r.id < ?`
      queryParams.push(parseInt(cursor))
    }

    query += ` ORDER BY r.last_name ASC, r.first_name ASC LIMIT ?`
    queryParams.push(limit + 1)

    const [rows] = (await db.execute(query, queryParams)) as [any[], any]

    const hasMore = rows.length > limit
    const runners = rows.slice(0, limit) || []

    return NextResponse.json({
      ok: true,
      data: runners,
      pagination: {
        hasMore,
        nextCursor: hasMore ? runners[runners.length - 1]?.id : null,
      },
    })
  } catch (err: any) {
    if (err.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('[api/nyrr/events/[id]/runners] GET error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
