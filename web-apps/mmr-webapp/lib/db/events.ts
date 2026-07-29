// ============================================================
// lib/db/events.ts — member-facing NYRR event calendar reads
//
// Source of truth is nyrr_events, populated by the NYRR discovery pipeline
// (mmr-admin/nyrr_scheduler.py, weekly). RSVP counts come from
// nyrr_event_rsvps (V037).
//
// Read-only. RSVP writes land in Session 3 (P1L).
// ============================================================

import type { RowDataPacket } from 'mysql2'
import db from '@/lib/db/connection'

// Range constants live in lib/events-range.ts, NOT here: client components need
// them, and importing this module from the browser bundle would pull in mysql2
// (the build fails with "Can't resolve 'net'/'tls'"). Anything the client needs
// as a *value* must stay out of this file — types are fine, they get erased.

export type RsvpIntent = 'running' | 'volunteering' | 'interested' | 'not_going'

export interface CalendarEvent {
  id: number
  eventCode: string | null
  eventName: string
  /** YYYY-MM-DD — formatted in SQL, never a driver Date (see note below). */
  eventDate: string
  location: string | null
  /** Human label ("Marathon") when NYRR gave us one; else derived from distanceKm. */
  distance: string | null
  distanceKm: number | null
  isVirtual: boolean
  eventUrl: string | null
  /** This member's own intent, or null if they haven't responded. */
  myIntent: RsvpIntent | null
  myNote: string | null
  runningCount: number
  volunteeringCount: number
  interestedCount: number
}

interface CalendarRow extends RowDataPacket {
  id: number
  event_code: string | null
  event_name: string
  event_date: string
  location: string | null
  distance: string | null
  distance_km: string | number | null
  is_virtual: number
  event_url: string | null
  my_intent: RsvpIntent | null
  my_note: string | null
  running_count: number | string
  volunteering_count: number | string
  interested_count: number | string
}

/**
 * Events between two YYYY-MM-DD dates (inclusive), oldest first, annotated with
 * this member's RSVP and the per-intent counts.
 *
 * Two deliberate choices:
 *  - event_date goes through DATE_FORMAT so it arrives as a 'YYYY-MM-DD' string.
 *    mysql2 otherwise hands back a Date for DATE columns, which JSON-serializes
 *    to a UTC instant and renders a day early west of Greenwich — the exact bug
 *    that hit the fulfillment emails on 07-29.
 *  - counts are computed in a grouped subquery rather than joined onto the main
 *    row set, so an event with many RSVPs can't fan out the event row.
 */
export async function getCalendarEvents(
  memberId: string,
  from: string,
  to: string
): Promise<CalendarEvent[]> {
  const [rows] = await db.execute<CalendarRow[]>(
    `SELECT
        e.id,
        e.event_code,
        e.event_name,
        DATE_FORMAT(e.event_date, '%Y-%m-%d') AS event_date,
        e.location,
        e.distance,
        e.distance_km,
        e.is_virtual,
        e.event_url,
        mine.intent AS my_intent,
        mine.note   AS my_note,
        COALESCE(agg.running_count, 0)      AS running_count,
        COALESCE(agg.volunteering_count, 0) AS volunteering_count,
        COALESCE(agg.interested_count, 0)   AS interested_count
     FROM nyrr_events e
     LEFT JOIN nyrr_event_rsvps mine
            ON mine.nyrr_event_id = e.id AND mine.MemberID = ?
     LEFT JOIN (
        SELECT nyrr_event_id,
               SUM(intent = 'running')      AS running_count,
               SUM(intent = 'volunteering') AS volunteering_count,
               SUM(intent = 'interested')   AS interested_count
        FROM nyrr_event_rsvps
        GROUP BY nyrr_event_id
     ) agg ON agg.nyrr_event_id = e.id
     WHERE e.event_date IS NOT NULL
       AND e.event_date BETWEEN ? AND ?
     ORDER BY e.event_date ASC, e.event_name ASC`,
    [memberId, from, to]
  )

  return rows.map(row => ({
    id: row.id,
    eventCode: row.event_code,
    eventName: row.event_name,
    eventDate: String(row.event_date),
    location: row.location,
    distance: row.distance,
    // DECIMAL comes back as a string from mysql2 — Number() or null, never NaN.
    distanceKm: row.distance_km == null ? null : Number(row.distance_km),
    isVirtual: row.is_virtual === 1,
    eventUrl: row.event_url,
    myIntent: row.my_intent,
    myNote: row.my_note,
    runningCount: Number(row.running_count),
    volunteeringCount: Number(row.volunteering_count),
    interestedCount: Number(row.interested_count),
  }))
}

/**
 * The latest event date we know about at all — used for empty-state copy.
 * NYRR publishes its calendar only ~8 weeks out, so a short calendar is normal
 * and the UI should say so rather than implying the feature is broken.
 */
export async function getLatestKnownEventDate(): Promise<string | null> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT DATE_FORMAT(MAX(event_date), '%Y-%m-%d') AS latest FROM nyrr_events`
  )
  const latest = rows[0]?.latest
  return latest ? String(latest) : null
}

// ─── RSVP ────────────────────────────────────────────────────────────────────

export const RSVP_INTENTS: readonly RsvpIntent[] = [
  'running',
  'volunteering',
  'interested',
  'not_going',
]

/** Event date ('YYYY-MM-DD') for an id, or null when the event doesn't exist. */
export async function getEventDate(eventId: number): Promise<string | null> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT DATE_FORMAT(event_date, '%Y-%m-%d') AS event_date FROM nyrr_events WHERE id = ?`,
    [eventId]
  )
  if (!rows.length) return null
  return rows[0].event_date ? String(rows[0].event_date) : null
}

/**
 * Record or change a member's RSVP. Idempotent by construction: the V037
 * UNIQUE (nyrr_event_id, MemberID) turns a repeat into an UPDATE, so a
 * double-tapped button can't create two rows.
 *
 * The new values are passed twice rather than using VALUES()/row aliases in the
 * UPDATE clause — VALUES() is deprecated as of MySQL 8.0.20 and the alias form
 * needs 8.0.19+, so explicit parameters keep this portable.
 */
export async function upsertRsvp(
  eventId: number,
  memberId: string,
  intent: RsvpIntent,
  note: string | null
): Promise<void> {
  await db.execute(
    `INSERT INTO nyrr_event_rsvps (nyrr_event_id, MemberID, intent, note)
     VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE intent = ?, note = ?`,
    [eventId, memberId, intent, note, intent, note]
  )
}

/** Clear a member's RSVP. Returns false when there was nothing to clear. */
export async function deleteRsvp(eventId: number, memberId: string): Promise<boolean> {
  const [result] = await db.execute(
    `DELETE FROM nyrr_event_rsvps WHERE nyrr_event_id = ? AND MemberID = ?`,
    [eventId, memberId]
  )
  return (result as { affectedRows?: number }).affectedRows! > 0
}

export interface RosterEntry {
  memberId: string
  name: string
  note: string | null
}

export interface EventRoster {
  running: RosterEntry[]
  volunteering: RosterEntry[]
  interested: RosterEntry[]
  /** Totals over ALL RSVPs, including members who opted out of being named. */
  counts: { running: number; volunteering: number; interested: number; notGoing: number }
  /** How many responders are counted but not listed, per the privacy opt-out. */
  hiddenCount: number
}

interface RosterRow extends RowDataPacket {
  MemberID: string
  intent: RsvpIntent
  note: string | null
  FirstName: string | null
  LastName: string | null
  ShowRsvpPublicly: number
}

/**
 * Who is going, grouped by intent.
 *
 * Privacy contract (V037 `members.ShowRsvpPublicly`, default 1): a member who
 * opts out is still COUNTED but never NAMED. The opt-out is applied here, in the
 * data layer, so no caller can accidentally leak a name by forgetting to filter.
 *
 * 'not_going' is counted but never listed — a decision not to attend isn't
 * something the club needs to publish next to someone's name.
 */
export async function getEventRoster(eventId: number): Promise<EventRoster> {
  const [rows] = await db.execute<RosterRow[]>(
    `SELECT r.MemberID, r.intent, r.note, m.FirstName, m.LastName, m.ShowRsvpPublicly
     FROM nyrr_event_rsvps r
     JOIN members m ON m.MemberID = r.MemberID
     WHERE r.nyrr_event_id = ?
     ORDER BY m.FirstName ASC, m.LastName ASC`,
    [eventId]
  )

  const roster: EventRoster = {
    running: [],
    volunteering: [],
    interested: [],
    counts: { running: 0, volunteering: 0, interested: 0, notGoing: 0 },
    hiddenCount: 0,
  }

  for (const row of rows) {
    if (row.intent === 'not_going') {
      roster.counts.notGoing += 1
      continue
    }

    const bucket =
      row.intent === 'running' ? 'running'
      : row.intent === 'volunteering' ? 'volunteering'
      : 'interested'

    roster.counts[bucket] += 1

    if (row.ShowRsvpPublicly !== 1) {
      roster.hiddenCount += 1
      continue
    }

    const name = [row.FirstName, row.LastName].filter(Boolean).join(' ').trim()
    roster[bucket].push({
      memberId: row.MemberID,
      // Never fall back to the email address — that would defeat the point of a
      // roster that only publishes display names.
      name: name || row.MemberID,
      note: row.note,
    })
  }

  return roster
}
