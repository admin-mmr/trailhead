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
