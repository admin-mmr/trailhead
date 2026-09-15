/**
 * Unit tests for lib/db/events-public.ts — the public home-page event feed.
 *
 * Two behaviours carry real risk and are what these tests pin:
 *
 *  1. NYRR lists the same race twice (canonical code '26GGG' AND URL slug
 *     'nyrr-grete-s-great-gallop-10k'). Undeduped, the home page shows the
 *     same race twice and the copy that says "latest events" looks broken.
 *  2. NYRR publishes only ~8 weeks ahead. In Sept 2026 there was exactly ONE
 *     future race on the books, so the feed has to backfill with recent races
 *     rather than render a single lonely row.
 */

jest.mock('@/lib/db/connection', () => ({ __esModule: true, default: { query: jest.fn() } }))

import db from '@/lib/db/connection'
import { getHomeEvents, getClubStats, getLatestKnownEventDate } from '@/lib/db/events-public'

const mockQuery = db.query as unknown as jest.Mock

/** Minimal row shaped like the SELECT in events-public.ts. */
function row(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: 1,
    event_code: 'X',
    event_name: 'Some Race',
    event_date: '2026-09-01',
    location: 'New York',
    distance: null,
    distance_km: null,
    event_url: null,
    is_upcoming: 0,
    matched: 0,
    ...over,
  }
}

beforeEach(() => jest.clearAllMocks())

describe('getHomeEvents', () => {
  it('collapses the canonical/slug duplicate and keeps the row with matched runners', async () => {
    mockQuery
      .mockResolvedValueOnce([[]]) // no upcoming
      .mockResolvedValueOnce([[
        row({ id: 10, event_code: 'nyrr-grete-s-great-gallop-10k', event_name: "NYRR Grete's Great Gallop 10K", event_date: '2026-08-22', matched: 0 }),
        row({ id: 11, event_code: '26GGG', event_name: "2026 NYRR Grete's Great Gallop 10K", event_date: '2026-08-22', matched: 27 }),
      ]])

    const events = await getHomeEvents(5)

    expect(events).toHaveLength(1)
    // The row with real matched runners is the one that survives.
    expect(events[0].id).toBe(11)
  })

  it('does NOT merge genuinely different races that share a date', async () => {
    mockQuery
      .mockResolvedValueOnce([[]])
      .mockResolvedValueOnce([[
        row({ id: 20, event_name: '2026 New Balance 5th Ave Mile', event_date: '2026-09-13' }),
        row({ id: 21, event_name: '2026 Stage 3 Back to School Mile', event_date: '2026-09-13' }),
      ]])

    expect(await getHomeEvents(5)).toHaveLength(2)
  })

  it('backfills with recent races when NYRR has published almost nothing ahead', async () => {
    mockQuery
      .mockResolvedValueOnce([[row({ id: 1, event_name: 'TCS New York City Marathon', event_date: '2026-11-01', is_upcoming: 1 })]])
      .mockResolvedValueOnce([[
        row({ id: 2, event_name: 'Race B', event_date: '2026-09-13' }),
        row({ id: 3, event_name: 'Race C', event_date: '2026-08-26' }),
      ]])

    const events = await getHomeEvents(3)

    expect(events.map(e => e.id)).toEqual([1, 2, 3])
    // Upcoming sorts first and is flagged, so the UI can label it.
    expect(events[0].isUpcoming).toBe(true)
    expect(events[1].isUpcoming).toBe(false)
  })

  it('skips the backfill query entirely when there are enough future races', async () => {
    mockQuery.mockResolvedValueOnce([[
      row({ id: 1, event_date: '2026-10-01', event_name: 'A', is_upcoming: 1 }),
      row({ id: 2, event_date: '2026-10-08', event_name: 'B', is_upcoming: 1 }),
    ]])

    const events = await getHomeEvents(2)

    expect(events).toHaveLength(2)
    expect(mockQuery).toHaveBeenCalledTimes(1)
  })

  it('strips the leading year NYRR prefixes onto event names', async () => {
    mockQuery
      .mockResolvedValueOnce([[row({ event_name: '2026 TCS New York City Marathon', is_upcoming: 1 })]])
      .mockResolvedValueOnce([[]])

    const [event] = await getHomeEvents(5)
    expect(event.eventName).toBe('TCS New York City Marathon')
  })

  it('prefers a NYRR distance label and derives one from km otherwise', async () => {
    mockQuery
      .mockResolvedValueOnce([[
        row({ id: 1, event_name: 'A', distance: 'Marathon', distance_km: 42.195, is_upcoming: 1 }),
        row({ id: 2, event_name: 'B', distance: null, distance_km: '10.0', is_upcoming: 1 }),
        row({ id: 3, event_name: 'C', distance: null, distance_km: null, is_upcoming: 1 }),
      ]])
      .mockResolvedValueOnce([[]]) // 3 future rows < limit 5, so the backfill still runs

    const events = await getHomeEvents(5)
    expect(events[0].distance).toBe('Marathon')
    expect(events[1].distance).toBe('10 km')
    // Every currently-listed upcoming race has both fields NULL, so this must
    // be null and never the string "null" or "0 km".
    expect(events[2].distance).toBeNull()
  })

  it('returns an empty list rather than throwing when nothing is scheduled', async () => {
    mockQuery.mockResolvedValueOnce([[]]).mockResolvedValueOnce([[]])
    expect(await getHomeEvents(5)).toEqual([])
  })
})

describe('getClubStats', () => {
  it('coerces driver strings to numbers', async () => {
    mockQuery.mockResolvedValueOnce([[{ active_members: '414', races_this_year: '47' }]])
    expect(await getClubStats()).toEqual({ activeMembers: 414, racesThisYear: 47 })
  })

  it('falls back to zero on an empty result instead of NaN', async () => {
    mockQuery.mockResolvedValueOnce([[]])
    expect(await getClubStats()).toEqual({ activeMembers: 0, racesThisYear: 0 })
  })
})

describe('getLatestKnownEventDate', () => {
  it('returns the furthest known race date for the empty-state copy', async () => {
    mockQuery.mockResolvedValueOnce([[{ d: '2026-11-01' }]])
    expect(await getLatestKnownEventDate()).toBe('2026-11-01')
  })

  it('returns null when the table is empty', async () => {
    mockQuery.mockResolvedValueOnce([[{ d: null }]])
    expect(await getLatestKnownEventDate()).toBeNull()
  })
})
