import { NextRequest, NextResponse } from 'next/server'
import { requireSession } from '@/lib/auth/session'
import { isAdmin } from '@/lib/db/admins'
import db from '@/lib/db/connection'

export const dynamic = 'force-dynamic'

/**
 * GET /api/nyrr/events
 *
 * List events with pagination.
 * Query params:
 * - cursor: lastId for pagination
 * - limit: default 20
 * - status: filter by processing_status
 * - year: filter by event_year
 *
 * Returns events ordered by event_date DESC with stats columns.
 * Calculates match percentage: mmr_matched_count / mmr_runner_count * 100
 */
export async function GET(req: NextRequest) {
  try {
    const session = await requireSession()
    if (!(await isAdmin(session.email))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const cursor = req.nextUrl.searchParams.get('cursor')
    const limit = Math.min(
      parseInt(req.nextUrl.searchParams.get('limit') ?? '20'),
      100
    )
    const statusFilter = req.nextUrl.searchParams.get('status')
    const yearFilter = req.nextUrl.searchParams.get('year')

    let query = `
      SELECT
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
      WHERE 1=1
    `
    const params: any[] = []

    if (statusFilter) {
      query += ` AND processing_status = ?`
      params.push(statusFilter)
    }

    if (yearFilter) {
      query += ` AND event_year = ?`
      params.push(parseInt(yearFilter))
    }

    if (cursor) {
      query += ` AND id < ?`
      params.push(parseInt(cursor))
    }

    query += ` ORDER BY event_date DESC LIMIT ?`
    params.push(limit + 1)

    const [rows] = (await db.execute(query, params)) as [any[], any]

    const hasMore = rows.length > limit
    const events = (rows.slice(0, limit) || []).map((row: any) => ({
      ...row,
      matchPercentage:
        row.mmr_runner_count > 0
          ? ((row.mmr_matched_count / row.mmr_runner_count) * 100).toFixed(1)
          : 0,
    }))

    return NextResponse.json({
      ok: true,
      data: events,
      pagination: {
        hasMore,
        nextCursor: hasMore ? events[events.length - 1]?.id : null,
      },
    })
  } catch (err: any) {
    if (err.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('[api/nyrr/events] GET error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
