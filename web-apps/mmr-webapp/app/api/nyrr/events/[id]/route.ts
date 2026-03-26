import { NextRequest, NextResponse } from 'next/server'
import { requireSession } from '@/lib/auth/session'
import { isAdmin } from '@/lib/db/admins'
import db from '@/lib/db/connection'

export const dynamic = 'force-dynamic'

/**
 * GET /api/nyrr/events/[id]
 *
 * Returns a single event with computed stats.
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

    const [rows] = (await db.execute(
      `SELECT
        id,
        event_code,
        event_name,
        event_url,
        location,
        distance,
        event_date,
        event_year,
        is_upcoming,
        is_virtual,
        processing_status,
        processed_at,
        processed_by,
        result_count,
        mmr_runner_count,
        mmr_matched_count,
        notes,
        created_at,
        updated_at
       FROM nyrr_events
       WHERE id = ?`,
      [eventId]
    )) as [any[], any]

    if (!rows || rows.length === 0) {
      return NextResponse.json({ error: 'Event not found' }, { status: 404 })
    }

    const event = rows[0]
    const data = {
      ...event,
      matchPercentage:
        event.mmr_runner_count > 0
          ? ((event.mmr_matched_count / event.mmr_runner_count) * 100).toFixed(1)
          : 0,
    }

    return NextResponse.json({ ok: true, data })
  } catch (err: any) {
    if (err.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('[api/nyrr/events/[id]] GET error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
