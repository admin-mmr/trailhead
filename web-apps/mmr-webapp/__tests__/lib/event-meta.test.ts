/**
 * Unit tests for the calendar's presentation helpers.
 *
 * distanceLabel exists because `distance` is NULL on most upcoming NYRR rows
 * (in July 2026 only the marathon had it) — rendering the raw column would put
 * "null" on the page.
 */

import {
  distanceLabel,
  groupByMonth,
  monthGridDays,
  monthKey,
  monthLabel,
  myIntentClass,
  myIntentKey,
} from '@/app/(member)/portal/events/_components/eventMeta'
import type { CalendarEvent } from '@/lib/db/events'

const event = (over: Partial<CalendarEvent> = {}): CalendarEvent => ({
  id: 1,
  eventCode: 'x',
  eventName: 'Some Race',
  eventDate: '2026-08-05',
  location: 'New York',
  distance: null,
  distanceKm: null,
  isVirtual: false,
  eventUrl: null,
  myIntent: null,
  myNote: null,
  runningCount: 0,
  volunteeringCount: 0,
  interestedCount: 0,
  ...over,
})

describe('distanceLabel', () => {
  it('prefers the NYRR label when present', () => {
    expect(distanceLabel(event({ distance: 'Marathon', distanceKm: 42.195 }), 'en')).toBe('Marathon')
  })

  it('falls back to km when the label is missing', () => {
    expect(distanceLabel(event({ distanceKm: 10 }), 'en')).toBe('10 km')
    expect(distanceLabel(event({ distanceKm: 10 }), 'zh')).toBe('10 公里')
  })

  it('trims float noise from the km fallback', () => {
    expect(distanceLabel(event({ distanceKm: 42.195 }), 'en')).toBe('42.2 km')
    expect(distanceLabel(event({ distanceKm: 21.0975 }), 'en')).toBe('21.1 km')
  })

  it('returns null — never "null" or "0 km" — when both are absent', () => {
    expect(distanceLabel(event(), 'en')).toBeNull()
    expect(distanceLabel(event({ distanceKm: 0 }), 'en')).toBeNull()
    expect(distanceLabel(event({ distance: '   ' }), 'en')).toBeNull()
  })
})

describe('myIntentKey / myIntentClass', () => {
  it('maps every intent to a distinct translation key', () => {
    expect(myIntentKey('running')).toBe('cal.youreRunning')
    expect(myIntentKey('volunteering')).toBe('cal.youreVolunteering')
    expect(myIntentKey('interested')).toBe('cal.youreInterested')
    expect(myIntentKey('not_going')).toBe('cal.notGoing')
  })

  it('has no badge for a member who has not responded', () => {
    expect(myIntentKey(null)).toBeNull()
  })

  it('gives running and volunteering visually distinct classes', () => {
    expect(myIntentClass('running')).not.toBe(myIntentClass('volunteering'))
    expect(myIntentClass(null)).toBeTruthy()
  })
})

describe('monthKey / monthLabel', () => {
  it('buckets by calendar month', () => {
    expect(monthKey('2026-08-05')).toBe('2026-08')
  })

  it('labels a month without shifting the year', () => {
    expect(monthLabel('2026-01', 'en')).toBe('January 2026')
    expect(monthLabel('2026-12', 'en')).toBe('December 2026')
  })
})

describe('groupByMonth', () => {
  it('groups consecutive same-month events, preserving order', () => {
    const groups = groupByMonth([
      event({ id: 1, eventDate: '2026-08-05' }),
      event({ id: 2, eventDate: '2026-08-26' }),
      event({ id: 3, eventDate: '2026-11-01' }),
    ])
    expect(groups.map(g => g.key)).toEqual(['2026-08', '2026-11'])
    expect(groups[0].events.map(e => e.id)).toEqual([1, 2])
    expect(groups[1].events).toHaveLength(1)
  })

  it('returns an empty array for no events', () => {
    expect(groupByMonth([])).toEqual([])
  })
})

describe('monthGridDays', () => {
  it('pads the leading weekday offset and fills whole weeks', () => {
    // 2026-08-01 is a Saturday → six leading pad cells.
    const cells = monthGridDays('2026-08')
    expect(cells.slice(0, 6).every(c => c === null)).toBe(true)
    expect(cells[6]).toBe('2026-08-01')
    expect(cells.length % 7).toBe(0)
  })

  it('includes every day of the month exactly once', () => {
    const real = monthGridDays('2026-08').filter(Boolean)
    expect(real).toHaveLength(31)
    expect(new Set(real).size).toBe(31)
    expect(real[30]).toBe('2026-08-31')
  })

  it('handles February in a leap and non-leap year', () => {
    expect(monthGridDays('2028-02').filter(Boolean)).toHaveLength(29)
    expect(monthGridDays('2027-02').filter(Boolean)).toHaveLength(28)
  })

  it('zero-pads day numbers so cells match API date strings', () => {
    expect(monthGridDays('2026-11').filter(Boolean)[0]).toBe('2026-11-01')
  })
})
