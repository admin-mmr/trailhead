/**
 * renewals.ts — who needs a renewal reminder, and who shares their membership.
 *
 * Timezone note, and it matters: the day count that decides a member's reminder
 * stage is computed from TODAY IN NEW YORK (lib/membership/expiration.ts), not
 * from the database's CURDATE(). The MySQL server runs in UTC, so CURDATE()
 * rolls over at 19:00/20:00 New York time — a member could land in a different
 * stage depending on what hour the job happened to run. The date window is
 * therefore computed in JS and passed in as literal civil dates, and every
 * DATE column comes back through DATE_FORMAT as a clean 'YYYY-MM-DD' string.
 *
 * Statuses: only 'active' and 'expired' members get reminders. 'inactive' means
 * someone deliberately left (230 rows) and 'lifetime' never expires — mailing
 * either would be a bug, not a nudge. 'pending' members have never paid and are
 * handled by the join flow instead.
 */

import type { RowDataPacket } from 'mysql2'
import { pool } from './connection'
import { daysBetween, nextExpiration, todayInNY, type CivilDate } from '../membership/expiration'

export interface RenewalCandidate {
  memberId:   string
  email:      string
  firstName:  string
  lastName:   string
  type:       string
  familyId:   string | null
  status:     string
  expiration: CivilDate
  /** Days until expiration, negative once lapsed. Computed in NY time. */
  daysLeft:   number
}

interface CandidateRow extends RowDataPacket {
  MemberID:   string
  Email:      string
  FirstName:  string
  LastName:   string
  Type:       string
  FamilyID:   string | null
  Status:     string
  Expiration: string
}

export interface FamilyMemberRow {
  memberId:   string
  firstName:  string
  lastName:   string
  email:      string
  status:     string
  expiration: CivilDate | null
}

interface FamilyRow extends RowDataPacket {
  MemberID:   string
  FirstName:  string
  LastName:   string
  Email:      string
  Status:     string
  Expiration: string | null
}

/** Shift a civil date by whole days, without touching local time. */
function shiftDays(date: CivilDate, days: number): CivilDate {
  const ms = Date.parse(`${date}T00:00:00Z`) + days * 86_400_000
  return new Date(ms).toISOString().slice(0, 10)
}

/**
 * Members whose expiration falls inside [today+minDays, today+maxDays].
 * minDays may be negative (lapsed members).
 *
 * Does NOT filter out members who were already reminded — the caller resolves
 * the stage and lets notification_log's claim do the deduplication, so the
 * decision lives in exactly one place.
 */
export async function getMembersDueForReminder(
  minDays: number,
  maxDays: number,
  today: CivilDate = todayInNY(),
): Promise<RenewalCandidate[]> {
  const from = shiftDays(today, Math.min(minDays, maxDays))
  const to   = shiftDays(today, Math.max(minDays, maxDays))

  const [rows] = await pool.execute<CandidateRow[]>(
    `SELECT MemberID, Email, FirstName, LastName, Type, FamilyID, Status,
            DATE_FORMAT(Expiration, '%Y-%m-%d') AS Expiration
       FROM members
      WHERE Status IN ('active','expired')
        AND Expiration IS NOT NULL
        AND Expiration BETWEEN ? AND ?
        AND Email <> ''
      ORDER BY Expiration, FamilyID, MemberID`,
    [from, to],
  )

  return rows.map((r) => ({
    memberId:   r.MemberID,
    email:      r.Email,
    firstName:  r.FirstName,
    lastName:   r.LastName,
    type:       r.Type,
    familyId:   r.FamilyID && r.FamilyID.trim() !== '' ? r.FamilyID : null,
    status:     r.Status,
    expiration: r.Expiration,
    daysLeft:   daysBetween(today, r.Expiration),
  }))
}

/**
 * Everyone sharing a FamilyID, in a stable order. Lifetime members are included
 * — they are part of the household and belong on the roster — but they are never
 * the reason a reminder goes out.
 */
export async function getFamilyRoster(familyId: string): Promise<FamilyMemberRow[]> {
  if (!familyId || familyId.trim() === '') return []
  const [rows] = await pool.execute<FamilyRow[]>(
    `SELECT MemberID, FirstName, LastName, Email, Status,
            DATE_FORMAT(Expiration, '%Y-%m-%d') AS Expiration
       FROM members
      WHERE FamilyID = ?
      ORDER BY MemberID`,
    [familyId],
  )
  return rows.map(toFamilyMember)
}

/** The family a member belongs to, or just that member when they have none. */
export async function getFamilyRosterForMember(memberId: string): Promise<FamilyMemberRow[]> {
  const [rows] = await pool.execute<FamilyRow[]>(
    `SELECT m.MemberID, m.FirstName, m.LastName, m.Email, m.Status,
            DATE_FORMAT(m.Expiration, '%Y-%m-%d') AS Expiration
       FROM members m
       JOIN members self
         ON self.MemberID = ?
        AND (
              (self.FamilyID IS NOT NULL AND self.FamilyID <> '' AND m.FamilyID = self.FamilyID)
              OR m.MemberID = self.MemberID
            )
      ORDER BY m.MemberID`,
    [memberId],
  )
  return rows.map(toFamilyMember)
}

function toFamilyMember(r: FamilyRow): FamilyMemberRow {
  return {
    memberId:   r.MemberID,
    firstName:  r.FirstName,
    lastName:   r.LastName,
    email:      r.Email,
    status:     r.Status,
    expiration: r.Expiration ?? null,
  }
}

/**
 * What a member's expiration WOULD become if they renewed today — the answer to
 * "what do I get for renewing now", which under the rolling rule is no longer a
 * fixed club-year date. Thin wrapper over nextExpiration so there is still only
 * one copy of the rule on this side of the boundary; the authoritative value is
 * whatever fn_next_expiration computes at payment time.
 */
export function previewRenewalDate(
  currentExpiration: CivilDate | null,
  years = 1,
  today: CivilDate = todayInNY(),
): CivilDate {
  return nextExpiration(currentExpiration, today, years)
}
