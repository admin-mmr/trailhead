// ============================================================
// lib/events-range.ts — date-range resolution for the member event calendar
//
// Pure functions on 'YYYY-MM-DD' strings: no Date-object round-trips past the
// component level, because DATE columns and calendar months are civil dates,
// not instants. Anchored to America/New_York (where the members are) so the
// default window doesn't shift when the server runs in UTC.
// ============================================================

import { parseLocalDate } from '@/lib/date'
import { httpError } from '@/lib/http-error'

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

// These live here rather than in lib/db/events.ts on purpose: the calendar client
// component imports this module, and importing the db module from the browser
// bundle pulls in mysql2 (build error: "Can't resolve 'net'"). Keep this file
// free of server-only imports.

/** How far the calendar looks by default: one month back, three months forward. */
export const DEFAULT_MONTHS_BACK = 1
export const DEFAULT_MONTHS_FORWARD = 3

/** Hard ceiling on a single request's span, so a crafted ?from/&to can't table-scan. */
export const MAX_RANGE_DAYS = 400

/** Today's civil date in America/New_York as 'YYYY-MM-DD'. */
export function todayNY(): string {
  // 'en-CA' formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date())
}

/** True only for a well-formed, real calendar date (rejects 2026-02-31). */
export function isValidDateStr(value: unknown): value is string {
  return typeof value === 'string' && DATE_RE.test(value) && parseLocalDate(value) !== null
}

function toParts(dateStr: string): [number, number, number] {
  const [y, m, d] = dateStr.split('-').map(Number)
  return [y, m, d]
}

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

/** Days in a given month (1-indexed month). */
function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

/**
 * Shift a civil date by whole months, clamping the day to the target month's
 * length so 2026-01-31 + 1 month is 2026-02-28, not a rollover into March.
 */
export function addMonths(dateStr: string, months: number): string {
  const [y, m, d] = toParts(dateStr)
  const zeroBased = y * 12 + (m - 1) + months
  const year = Math.floor(zeroBased / 12)
  const month = (zeroBased % 12) + 1
  const day = Math.min(d, daysInMonth(year, month))
  return `${year}-${pad(month)}-${pad(day)}`
}

/** Shift a civil date by whole days. Uses UTC arithmetic — no DST drift. */
export function addDays(dateStr: string, days: number): string {
  const [y, m, d] = toParts(dateStr)
  const shifted = new Date(Date.UTC(y, m - 1, d + days))
  return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`
}

/** Inclusive day count between two civil dates. */
export function daysBetween(from: string, to: string): number {
  const [fy, fm, fd] = toParts(from)
  const [ty, tm, td] = toParts(to)
  const ms = Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)
  return Math.round(ms / 86_400_000)
}

export interface ResolvedRange {
  from: string
  to: string
  /** True when the requested span exceeded MAX_RANGE_DAYS and `to` was pulled in. */
  clamped: boolean
}

/**
 * Resolve the ?from / ?to query pair into a bounded range.
 *
 * - Either side absent or malformed → that side falls back to the default window
 *   (one month back / three months forward from today in NY). A short calendar is
 *   expected: NYRR publishes only ~8 weeks out, so a window that ends at "today"
 *   would frequently render empty.
 * - from later than to → 400. Silently swapping would hide a caller bug.
 * - span over MAX_RANGE_DAYS → `to` is clamped and `clamped` is set, so the
 *   response can tell the client its window was trimmed.
 */
export function resolveRange(
  fromParam?: string | null,
  toParam?: string | null,
  today: string = todayNY()
): ResolvedRange {
  const from = isValidDateStr(fromParam) ? fromParam : addMonths(today, -DEFAULT_MONTHS_BACK)
  const to = isValidDateStr(toParam) ? toParam : addMonths(today, DEFAULT_MONTHS_FORWARD)

  if (daysBetween(from, to) < 0) {
    throw httpError(400, '`from` must not be later than `to`')
  }

  if (daysBetween(from, to) > MAX_RANGE_DAYS) {
    return { from, to: addDays(from, MAX_RANGE_DAYS), clamped: true }
  }

  return { from, to, clamped: false }
}
