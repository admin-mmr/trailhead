import { requireSession } from '@/lib/auth/session'
import { getDb } from '@/lib/db/connection'
import NyrrClient from './NyrrClient'

export const metadata = { title: 'NYRR Results' }

async function getNyrrResults(memberId: string) {
  const db = getDb()
  const [rows] = await db.execute<any[]>(
    `SELECT * FROM nyrr_results
     WHERE member_id = ?
     ORDER BY event_date DESC
     LIMIT 50`,
    [memberId]
  )
  return rows.map(r => ({
    id:            r.id,
    memberId:      r.member_id,
    nyrrEventCode: r.nyrr_event_code,
    eventName:     r.event_name,
    eventDate:     r.event_date instanceof Date ? r.event_date.toISOString().slice(0, 10) : r.event_date,
    finishTime:    r.finish_time ?? undefined,
    pace:          r.pace ?? undefined,
    overallPlace:  r.overall_place ?? undefined,
    genderPlace:   r.gender_place ?? undefined,
    ageGroupPlace: r.age_group_place ?? undefined,
    distance:      r.distance ?? undefined,
  }))
}

export default async function NyrrPage() {
  const session = await requireSession()
  const results = await getNyrrResults(session.memberId)
  return <NyrrClient results={results} />
}
