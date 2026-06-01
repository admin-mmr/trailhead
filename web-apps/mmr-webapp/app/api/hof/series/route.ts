import { NextResponse } from 'next/server'
import db from '@/lib/db/connection'

export const dynamic = 'force-dynamic'

/**
 * GET /api/hof/series
 * Public — no auth required.
 * Lists all race series with event counts and MMR data availability.
 */
export async function GET() {
  try {
    const [rows] = (await db.execute(`
      SELECT
        s.id,
        s.name,
        s.slug,
        s.distance_km,
        s.notes,
        COUNT(e.id)                                  AS event_count,
        SUM(e.processing_status = 'Completed')       AS events_completed,
        SUM(r.mmr_team_runners > 0)                  AS events_with_mmr
      FROM nyrr_event_series s
      LEFT JOIN nyrr_events e ON e.series_id = s.id
      LEFT JOIN (
        SELECT nyrr_event_id, COUNT(*) AS mmr_team_runners
        FROM nyrr_event_runners
        WHERE team_code = 'MMR'
        GROUP BY nyrr_event_id
      ) r ON r.nyrr_event_id = e.id
      GROUP BY s.id, s.name, s.slug, s.distance_km, s.notes
      ORDER BY s.name
    `)) as [any[], any]

    return NextResponse.json({ ok: true, series: rows })
  } catch (err) {
    console.error('[api/hof/series] GET error:', err)
    return NextResponse.json({ ok: false, error: 'Internal server error' }, { status: 500 })
  }
}
