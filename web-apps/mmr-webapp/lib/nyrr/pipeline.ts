/**
 * NYRR sync pipeline — migrated from Google Apps Script pipeline.js
 * Run via Azure Functions timer triggers (replaces ScriptApp time-based triggers)
 *
 * Pass 1: collectClubRunners   — team code "MMR" in NYRR team search
 * Pass 2: collectMemberRunners — cross-reference member NYRR IDs from DB
 */

import { getDb } from '@/lib/db/connection'
import { getTeamRunners, getRunnerResults, getEventFinishers, getAllEvents } from './api'

/** Weekly: sync all NYRR events and MMR team results */
export async function processAllPendingNyrrEvents(): Promise<void> {
  const db      = getDb()
  const [pending] = await db.execute<any[]>(
    `SELECT nyrr_event_code, name FROM nyrr_events WHERE status = 'pending'`
  )

  for (const event of pending) {
    console.log(`[NYRR Pipeline] Processing event: ${event.nyrr_event_code}`)
    await matchNyrrResultsToMembers(event.nyrr_event_code)

    await db.execute(
      `UPDATE nyrr_events SET status = 'completed' WHERE nyrr_event_code = ?`,
      [event.nyrr_event_code]
    )
  }
}

/** Daily: refresh upcoming events list */
export async function refreshUpcomingNyrrEvents(): Promise<void> {
  const db     = getDb()
  const events = await getAllEvents()

  for (const event of events) {
    await db.execute(
      `INSERT INTO nyrr_events (nyrr_event_code, name, date, status)
       VALUES (?, ?, ?, 'upcoming')
       ON DUPLICATE KEY UPDATE name = VALUES(name), date = VALUES(date)`,
      [event.eventCode, event.name, event.date]
    )
  }
  console.log(`[NYRR Pipeline] Refreshed ${events.length} upcoming events`)
}

/** Match NYRR race results to MMR member records (two-pass) */
export async function matchNyrrResultsToMembers(eventCode: string): Promise<void> {
  const db = getDb()

  // ── Pass 1: club team search (MMR) ──────────────────────────
  const clubRunners = await getTeamRunners(eventCode, 'MMR')
  const clubNyrrIds = new Set(clubRunners.map((r: any) => String(r.runnerId)))

  // ── Pass 2: member NYRR ID cross-reference ──────────────────
  const [members] = await db.execute<any[]>(
    `SELECT member_id, nyrr_id FROM members WHERE nyrr_id IS NOT NULL`
  )
  const memberMap = new Map<string, string>() // nyrrId → memberId
  for (const m of members) memberMap.set(String(m.nyrr_id), m.member_id)

  // ── Collect finishers ────────────────────────────────────────
  const finishers = await getEventFinishers(eventCode)

  let inserted = 0
  for (const f of finishers) {
    const nyrrId = String(f.runnerId)
    // Match if in club team OR in member NYRR ID list
    const memberId = memberMap.get(nyrrId) ?? (clubNyrrIds.has(nyrrId) ? null : undefined)
    if (memberId === undefined) continue // not an MMR member

    const [existing] = await db.execute<any[]>(
      `SELECT id FROM nyrr_results WHERE member_id = ? AND nyrr_event_code = ?`,
      [memberId ?? nyrrId, eventCode]
    )
    if (existing.length) continue

    await db.execute(
      `INSERT INTO nyrr_results
         (member_id, nyrr_event_code, event_name, event_date, finish_time, pace,
          overall_place, gender_place, age_group_place, distance)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        memberId ?? `nyrr:${nyrrId}`,
        eventCode,
        f.eventName ?? eventCode,
        f.finishDate ?? null,
        f.finishTime ?? null,
        f.pace ?? null,
        f.overallPlace ?? null,
        f.genderPlace ?? null,
        f.ageGroupPlace ?? null,
        f.distance ?? null,
      ]
    )
    inserted++
  }
  console.log(`[NYRR Pipeline] ${eventCode}: inserted ${inserted} results`)
}

/** Backfill all historical results for a single member's NYRR ID */
export async function backfillMemberResults(nyrrId: string, mmrMemberId: string): Promise<void> {
  const db      = getDb()
  const results = await getRunnerResults(nyrrId)

  for (const r of results) {
    await db.execute(
      `INSERT IGNORE INTO nyrr_results
         (member_id, nyrr_event_code, event_name, event_date, finish_time, pace,
          overall_place, gender_place, age_group_place, distance)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        mmrMemberId, r.eventCode, r.eventName, r.finishDate,
        r.finishTime, r.pace, r.overallPlace, r.genderPlace, r.ageGroupPlace, r.distance,
      ]
    )
  }
  console.log(`[NYRR Backfill] Backfilled ${results.length} results for member ${mmrMemberId}`)
}
