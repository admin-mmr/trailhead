import type { RowDataPacket } from 'mysql2'
import db from '@/lib/db/connection'

/**
 * Public, unauthenticated event feed for the marketing home page.
 *
 * Deliberately separate from `lib/db/events.ts`: that module is member-scoped
 * (it annotates every row with the caller's own RSVP and needs a MemberID).
 * Nothing here takes a member, so there is no way for a public caller to
 * accidentally surface another member's RSVP.
 */
export interface PublicEvent {
  id: number
  eventCode: string | null
  eventName: string
  /** YYYY-MM-DD — formatted in SQL so mysql2 can't hand back a UTC Date. */
  eventDate: string
  location: string | null
  distance: string | null
  eventUrl: string | null
  /** True when the race has not happened yet (compared in SQL against CURDATE()). */
  isUpcoming: boolean
}

interface PublicEventRow extends RowDataPacket {
  id: number
  event_code: string | null
  event_name: string
  event_date: string
  location: string | null
  distance: string | null
  distance_km: string | number | null
  event_url: string | null
  is_upcoming: number
  matched: number | null
}

/** "Marathon" when NYRR labelled it, else a distance derived from km. */
function distanceLabel(distance: string | null, km: string | number | null): string | null {
  if (distance && distance.trim()) return distance.trim()
  const n = km == null ? NaN : Number(km)
  if (!Number.isFinite(n) || n <= 0) return null
  return `${Number(n.toFixed(1))} km`
}

/**
 * NYRR gives us the same race twice: once under its canonical code ('26GGG')
 * and once under a URL slug ('nyrr-grete-s-great-gallop-10k'). They are
 * reconciled in the admin pipeline but stragglers remain, so the public feed
 * collapses them on (date, lowercased name-ish) and keeps the row that
 * actually has matched MMR runners.
 */
function dedupe(rows: PublicEventRow[]): PublicEventRow[] {
  const byKey = new Map<string, PublicEventRow>()
  for (const row of rows) {
    // Normalise: NYRR prefixes some names with the year, some not.
    const name = row.event_name.toLowerCase().replace(/[^a-z0-9]+/g, '').replace(/^20\d\d/, '')
    const key = `${row.event_date}|${name}`
    const seen = byKey.get(key)
    if (!seen || Number(row.matched ?? 0) > Number(seen.matched ?? 0)) byKey.set(key, row)
  }
  return Array.from(byKey.values())
}

function toPublicEvent(row: PublicEventRow): PublicEvent {
  return {
    id: row.id,
    eventCode: row.event_code,
    eventName: row.event_name.replace(/^20\d\d\s+/, ''),
    eventDate: row.event_date,
    location: row.location,
    distance: distanceLabel(row.distance, row.distance_km),
    eventUrl: row.event_url,
    isUpcoming: Number(row.is_upcoming) === 1,
  }
}

const SELECT_COLS = `
  e.id, e.event_code, e.event_name,
  DATE_FORMAT(e.event_date, '%Y-%m-%d') AS event_date,
  e.location, e.distance, e.distance_km, e.event_url,
  (e.event_date >= CURDATE()) AS is_upcoming,
  e.mmr_matched_count AS matched
`

/**
 * The home page's "Latest Events" feed: every upcoming race first, then recent
 * past races to fill out the list.
 *
 * NYRR publishes its calendar only ~8 weeks ahead, so for most of the year
 * there are very few future rows (in Sept 2026: exactly one). Showing a single
 * lonely row reads as a broken page, so we backfill with races that just
 * happened — which are genuinely interesting, since that is where members'
 * results and photos come from.
 */
export async function getHomeEvents(limit = 5): Promise<PublicEvent[]> {
  const [upcoming] = await db.query<PublicEventRow[]>(
    `SELECT ${SELECT_COLS} FROM nyrr_events e
      WHERE e.event_date >= CURDATE()
      ORDER BY e.event_date ASC
      LIMIT ?`,
    [limit * 2],
  )

  const future = dedupe(upcoming).slice(0, limit)
  if (future.length >= limit) return future.map(toPublicEvent)

  const [past] = await db.query<PublicEventRow[]>(
    `SELECT ${SELECT_COLS} FROM nyrr_events e
      WHERE e.event_date < CURDATE()
      ORDER BY e.event_date DESC
      LIMIT ?`,
    [(limit - future.length) * 3],
  )

  const recent = dedupe(past).slice(0, limit - future.length)
  return [...future, ...recent].map(toPublicEvent)
}

/** Latest race we know about at all — used for honest empty-state copy. */
export async function getLatestKnownEventDate(): Promise<string | null> {
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT DATE_FORMAT(MAX(event_date), '%Y-%m-%d') AS d FROM nyrr_events`,
  )
  return (rows[0]?.d as string | null) ?? null
}

export interface ClubStats {
  activeMembers: number
  racesThisYear: number
}

/**
 * Headline numbers for the hero stat strip. Wrapped by the caller in try/catch:
 * a stats hiccup must never take down the marketing page.
 */
export async function getClubStats(): Promise<ClubStats> {
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT
       (SELECT COUNT(*) FROM members WHERE Status = 'active') AS active_members,
       (SELECT COUNT(*) FROM nyrr_events WHERE event_year = YEAR(CURDATE())) AS races_this_year`,
  )
  return {
    activeMembers: Number(rows[0]?.active_members ?? 0),
    racesThisYear: Number(rows[0]?.races_this_year ?? 0),
  }
}
