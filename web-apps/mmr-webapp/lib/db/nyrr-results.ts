// ============================================================
// lib/db/nyrr-results.ts — member-facing NYRR race results + self-service linking
//
// Results come from nyrr_event_runners rows whose mmr_member_id is this member.
// Linking is member-CONFIRMED, never blind: we propose candidate runner rows and
// only write mmr_member_id for rows the member picks AND that still satisfy the
// server-side match criteria.
//
// Mirrors the admin tiers in mmr-admin/api_events_match.py, with one deliberate
// difference: the age check compares against the EVENT year, not the current
// year. The admin Tier-2 SQL uses YEAR(CURDATE()), which makes the check
// meaningless for historical events.
// ============================================================

import type { RowDataPacket } from 'mysql2'
import db from '@/lib/db/connection'

/** Age recorded by NYRR is age at race time, and their data is noisy. */
export const AGE_TOLERANCE = 1

/** Hard cap on proposed candidates — nyrr_event_runners has ~1.6M unmatched rows. */
export const MAX_CANDIDATES = 50

export interface MemberResult {
  id: number
  eventId: number
  eventName: string
  eventDate: string
  eventUrl: string | null
  distance: string | null
  bibNumber: string | null
  finishTime: string | null
  pace: string | null
  overallPlace: number | null
  genderPlace: number | null
  ageGradePercent: number | null
  age: number | null
  matchMethod: string | null
}

interface ResultRow extends RowDataPacket {
  id: number
  event_id: number
  event_name: string
  event_date: string
  event_url: string | null
  distance: string | null
  bib_number: string | null
  finish_time: string | null
  pace: string | null
  overall_place: number | null
  gender_place: number | null
  age_grade_percent: string | number | null
  age: number | null
  match_method: string | null
}

const RESULT_COLUMNS = `
  ner.id,
  ne.id                                        AS event_id,
  ne.event_name,
  DATE_FORMAT(ne.event_date, '%Y-%m-%d')       AS event_date,
  ne.event_url,
  ne.distance,
  ner.bib_number,
  ner.finish_time,
  ner.pace,
  ner.overall_place,
  ner.gender_place,
  ner.age_grade_percent,
  ner.age,
  ner.match_method`

function toResult(row: ResultRow): MemberResult {
  return {
    id: row.id,
    eventId: row.event_id,
    eventName: row.event_name,
    eventDate: String(row.event_date),
    eventUrl: row.event_url,
    distance: row.distance,
    bibNumber: row.bib_number,
    finishTime: row.finish_time,
    pace: row.pace,
    overallPlace: row.overall_place,
    genderPlace: row.gender_place,
    // DECIMAL(5,2) arrives as a string from mysql2.
    ageGradePercent: row.age_grade_percent == null ? null : Number(row.age_grade_percent),
    age: row.age,
    matchMethod: row.match_method,
  }
}

/** This member's linked results, newest race first. */
export async function getMemberResults(memberId: string): Promise<MemberResult[]> {
  const [rows] = await db.execute<ResultRow[]>(
    `SELECT ${RESULT_COLUMNS}
     FROM nyrr_event_runners ner
     JOIN nyrr_events ne ON ne.id = ner.nyrr_event_id
     WHERE ner.mmr_member_id = ?
     ORDER BY ne.event_date DESC, ne.event_name ASC`,
    [memberId]
  )
  return rows.map(toResult)
}

/** NYRR reports M/W/X; members.Gender stores Male/Female/Other. '' means unknown. */
function normalizeMemberGender(gender: string | null | undefined): string | null {
  if (!gender) return null
  const g = gender.trim()
  if (!g) return null
  if (g === 'Male' || g === 'Female' || g === 'Other') return g
  return null // Non-binary / Prefer not to say → don't filter on it
}

export interface CandidateCriteria {
  nyrrRunnerName: string
  yearBorn: number
  /** members.Gender, used only to exclude clear mismatches. */
  memberGender?: string | null
}

/**
 * Runner rows that plausibly belong to this member, for the member to confirm.
 *
 * Deliberately narrow — a wrong link poisons NYRRRunnerName and then makes the
 * admin's Tier-1 matcher "confidently" recreate the bad match:
 *  - full runner_name equality, or first+last equality (both indexed columns),
 *  - age within ±1 of (event_year − yearBorn) when NYRR recorded an age,
 *  - gender must not contradict the member's, when both are known,
 *  - only rows that are unlinked or already linked to THIS member.
 *
 * No single-name (last-name-only) tier: the admin path deliberately stopped
 * auto-committing that after it produced wrong matches, and it would be worse
 * here where the member sees a pre-filtered list and is likely to trust it.
 *
 * ⚠️ Name comparisons are plain `=`, NOT LOWER(TRIM(col)) — the columns are
 * utf8mb4_unicode_ci, so `=` is already case-insensitive, while wrapping the
 * column in a function makes the index unusable. Measured against prod:
 * plain `=` uses idx_runner_name and examines 6 rows; the LOWER(TRIM(…)) form
 * scans 1,634,888 and takes ~8s. Trim the INPUT (below), never the column.
 */
export async function findRunnerCandidates(
  memberId: string,
  criteria: CandidateCriteria
): Promise<MemberResult[]> {
  const fullName = criteria.nyrrRunnerName.trim()
  const tokens = fullName.split(/\s+/)
  const firstName = tokens.length > 1 ? tokens[0] : null
  const lastName = tokens.length > 1 ? tokens[tokens.length - 1] : null
  const gender = normalizeMemberGender(criteria.memberGender)

  const [rows] = await db.execute<ResultRow[]>(
    `SELECT ${RESULT_COLUMNS}
     FROM nyrr_event_runners ner
     JOIN nyrr_events ne ON ne.id = ner.nyrr_event_id
     WHERE (ner.mmr_member_id IS NULL OR ner.mmr_member_id = ?)
       AND (
         ner.runner_name = ?
         OR (
           ? IS NOT NULL
           AND ner.first_name = ?
           AND ner.last_name  = ?
         )
       )
       AND (
         ner.age IS NULL OR ner.age = 0
         OR ne.event_year IS NULL
         OR ABS(CAST(ne.event_year AS SIGNED) - ? - ner.age) <= ?
       )
       AND (
         ? IS NULL
         OR ner.gender IS NULL OR ner.gender = ''
         OR CASE ner.gender
              WHEN 'M' THEN 'Male'
              WHEN 'W' THEN 'Female'
              WHEN 'X' THEN 'Other'
              ELSE ner.gender
            END = ?
       )
     ORDER BY ne.event_date DESC
     LIMIT ${MAX_CANDIDATES}`,
    [
      memberId,
      fullName,
      firstName, firstName, lastName,
      criteria.yearBorn, AGE_TOLERANCE,
      gender, gender,
    ]
  )
  return rows.map(toResult)
}

/**
 * Link the chosen runner rows to this member.
 *
 * `runnerIds` is treated as untrusted: the caller could post any row id, so the
 * ids are intersected with a freshly computed candidate set instead of being
 * written directly. The UPDATE also re-asserts the ownership guard so a row that
 * got claimed by someone else in the meantime is never stolen.
 *
 * Writes match_method='manual' and matched_by='member:<id>' so the audit trail
 * distinguishes self-service links from admin ones, and admins can still
 * override them in the match queue.
 */
export async function confirmRunnerLinks(
  memberId: string,
  runnerIds: number[],
  criteria: CandidateCriteria
): Promise<{ linked: number; eventIds: number[] }> {
  const candidates = await findRunnerCandidates(memberId, criteria)
  const eligible = new Set(candidates.map(c => c.id))
  const allowed = runnerIds.filter(id => eligible.has(id))
  if (!allowed.length) return { linked: 0, eventIds: [] }

  const placeholders = allowed.map(() => '?').join(', ')
  const [result] = await db.execute(
    `UPDATE nyrr_event_runners
     SET mmr_member_id = ?, match_method = 'manual',
         matched_by = ?, matched_at = NOW()
     WHERE id IN (${placeholders})
       AND (mmr_member_id IS NULL OR mmr_member_id = ?)`,
    [memberId, `member:${memberId}`, ...allowed, memberId]
  )

  const eventIds = Array.from(
    new Set(candidates.filter(c => allowed.includes(c.id)).map(c => c.eventId))
  )
  await refreshMatchedCounts(eventIds)

  return { linked: (result as { affectedRows?: number }).affectedRows ?? 0, eventIds }
}

/**
 * Keep nyrr_events.mmr_matched_count in step, the way the admin automatch does —
 * otherwise the admin dashboards drift every time a member links themselves.
 */
async function refreshMatchedCounts(eventIds: number[]): Promise<void> {
  if (!eventIds.length) return
  const placeholders = eventIds.map(() => '?').join(', ')
  await db.execute(
    `UPDATE nyrr_events ne
     SET ne.mmr_matched_count = (
       SELECT COUNT(*) FROM nyrr_event_runners
       WHERE nyrr_event_id = ne.id AND mmr_member_id IS NOT NULL
     )
     WHERE ne.id IN (${placeholders})`,
    eventIds
  )
}
