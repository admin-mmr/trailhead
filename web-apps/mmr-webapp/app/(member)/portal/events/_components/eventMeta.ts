// Shared presentation helpers for the member race calendar.
// Kept framework-free so they can be unit-tested without rendering.

import type { CalendarEvent, RsvpIntent } from '@/lib/db/events'
import type { Lang, TranslationKey } from '@/lib/i18n/translations'

/**
 * Distance label for an event, or null when we genuinely don't know.
 *
 * `distance` is NULL on most upcoming rows (NYRR only fills it in near race day —
 * of the 8 events on the calendar in July 2026, only the marathon had it), so fall
 * back to distance_km and otherwise render nothing. Never show "null" or "0 km".
 */
export function distanceLabel(event: CalendarEvent, lang: Lang): string | null {
  if (event.distance && event.distance.trim()) return event.distance.trim()
  if (event.distanceKm && event.distanceKm > 0) {
    const km = Number(event.distanceKm.toFixed(2))
    return lang === 'zh' ? `${km} 公里` : `${km} km`
  }
  return null
}

/** Translation key for the caller's own intent badge, or null if no RSVP. */
export function myIntentKey(intent: RsvpIntent | null): TranslationKey | null {
  switch (intent) {
    case 'running':      return 'cal.youreRunning'
    case 'volunteering': return 'cal.youreVolunteering'
    case 'interested':   return 'cal.youreInterested'
    case 'not_going':    return 'cal.notGoing'
    default:             return null
  }
}

/** Tailwind classes for the caller's own intent badge. */
export function myIntentClass(intent: RsvpIntent | null): string {
  switch (intent) {
    case 'running':      return 'bg-brand-orange/15 text-brand-orange'
    case 'volunteering': return 'bg-emerald-100 text-emerald-700'
    case 'interested':   return 'bg-sky-100 text-sky-700'
    case 'not_going':    return 'bg-gray-100 text-gray-500'
    default:             return 'bg-gray-100 text-gray-500'
  }
}

/** 'YYYY-MM' bucket key for grouping events by month. */
export function monthKey(dateStr: string): string {
  return dateStr.slice(0, 7)
}

/** Localized "August 2026" heading for a 'YYYY-MM' key. */
export function monthLabel(key: string, lang: Lang): string {
  const [y, m] = key.split('-').map(Number)
  const d = new Date(y, m - 1, 1) // local — month/year only, no DST edge
  return d.toLocaleDateString(lang === 'zh' ? 'zh-CN' : 'en-US', {
    month: 'long',
    year: 'numeric',
  })
}

/** Group events into ordered month buckets. Input must already be date-sorted. */
export function groupByMonth(events: CalendarEvent[]): { key: string; events: CalendarEvent[] }[] {
  const buckets: { key: string; events: CalendarEvent[] }[] = []
  for (const event of events) {
    const key = monthKey(event.eventDate)
    const last = buckets[buckets.length - 1]
    if (last && last.key === key) last.events.push(event)
    else buckets.push({ key, events: [event] })
  }
  return buckets
}

/**
 * Calendar-grid cells for a 'YYYY-MM', padded to whole weeks starting Sunday.
 * `null` marks a padding cell outside the month.
 */
export function monthGridDays(key: string): (string | null)[] {
  const [y, m] = key.split('-').map(Number)
  const firstWeekday = new Date(Date.UTC(y, m - 1, 1)).getUTCDay()
  const total = new Date(Date.UTC(y, m, 0)).getUTCDate()

  const cells: (string | null)[] = Array(firstWeekday).fill(null)
  for (let day = 1; day <= total; day++) {
    cells.push(`${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`)
  }
  while (cells.length % 7 !== 0) cells.push(null)
  return cells
}
