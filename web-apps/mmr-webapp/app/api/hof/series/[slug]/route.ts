import { NextRequest, NextResponse } from 'next/server'
import db from '@/lib/db/connection'

export const dynamic = 'force-dynamic'

// ---------------------------------------------------------------------------
// HOF category definitions (mirrors api_hof.py _CATEGORIES)
// ---------------------------------------------------------------------------

const CATEGORIES = [
  { key: 'men_open',   label: 'Men Open',    label_zh: '男子公开组',   gender: 'M', min_age: null },
  { key: 'men_40',     label: 'Men 40+',     label_zh: '男子40岁以上', gender: 'M', min_age: 40 },
  { key: 'men_50',     label: 'Men 50+',     label_zh: '男子50岁以上', gender: 'M', min_age: 50 },
  { key: 'men_60',     label: 'Men 60+',     label_zh: '男子60岁以上', gender: 'M', min_age: 60 },
  { key: 'women_open', label: 'Women Open',  label_zh: '女子公开组',   gender: 'W', min_age: null },
  { key: 'women_40',   label: 'Women 40+',   label_zh: '女子40岁以上', gender: 'W', min_age: 40 },
  { key: 'women_50',   label: 'Women 50+',   label_zh: '女子50岁以上', gender: 'W', min_age: 50 },
  { key: 'women_60',   label: 'Women 60+',   label_zh: '女子60岁以上', gender: 'W', min_age: 60 },
]

async function fetchCategory(
  seriesId: number,
  gender: string,
  minAge: number | null,
) {
  const ageClause = minAge != null ? `AND r.age >= ${minAge}` : ''
  const [rows] = (await db.execute(
    `SELECT
       r.runner_name,
       r.gender,
       r.age,
       r.mmr_member_id,
       ANY_VALUE(e.event_name) AS event_name,
       ANY_VALUE(e.event_year) AS event_year,
       MIN(TIME_TO_SEC(r.finish_time)) AS best_sec,
       MIN(r.finish_time)              AS best_time
     FROM nyrr_event_runners r
     JOIN nyrr_events e ON e.id = r.nyrr_event_id
     WHERE e.series_id = ?
       AND r.team_code = 'MMR'
       AND r.finish_time IS NOT NULL
       AND r.finish_time != ''
       AND r.gender = ?
       ${ageClause}
     GROUP BY
       COALESCE(r.mmr_member_id, r.runner_name),
       r.runner_name, r.gender, r.age, r.mmr_member_id
     ORDER BY best_sec ASC
     LIMIT 3`,
    [seriesId, gender],
  )) as [any[], any]

  return (rows || []).map((r: any) => ({
    runner_name:    r.runner_name,
    mmr_member_id:  r.mmr_member_id ?? null,
    age:            r.age ?? null,
    finish_time:    r.best_time,
    event_name:     r.event_name,
    event_year:     r.event_year,
  }))
}

/**
 * GET /api/hof/series/[slug]
 * Public — no auth required.
 * 8-category Hall of Fame for a race series (all editions combined).
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: { slug: string } },
) {
  try {
    const { slug } = params

    const [seriesRows] = (await db.execute(
      `SELECT
         s.id,
         s.name,
         s.slug,
         s.distance_km,
         s.notes,
         COUNT(e.id)                            AS event_count,
         SUM(e.processing_status = 'Completed') AS events_completed
       FROM nyrr_event_series s
       LEFT JOIN nyrr_events e ON e.series_id = s.id
       WHERE s.slug = ?
       GROUP BY s.id, s.name, s.slug, s.distance_km, s.notes`,
      [slug],
    )) as [any[], any]

    if (!seriesRows || seriesRows.length === 0) {
      return NextResponse.json({ ok: false, error: 'Series not found' }, { status: 404 })
    }

    const series = seriesRows[0]

    const categories = await Promise.all(
      CATEGORIES.map(async (cat) => {
        const podium = await fetchCategory(series.id, cat.gender, cat.min_age)
        return {
          ...cat,
          podium,
          best: podium[0] ?? null,
        }
      }),
    )

    return NextResponse.json({ ok: true, series, categories })
  } catch (err) {
    console.error('[api/hof/series/[slug]] GET error:', err)
    return NextResponse.json({ ok: false, error: 'Internal server error' }, { status: 500 })
  }
}
