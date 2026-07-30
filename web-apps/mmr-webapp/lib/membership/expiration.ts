/**
 * expiration.ts — the membership renewal rule, in TypeScript.
 *
 *     new expiration = MAX(current expiration + N years, anchor + N years)
 *
 * ⚠️ This MIRRORS the SQL function `fn_next_expiration` (db/MIGRATION_V038.sql),
 * which is what the live renewal path actually uses — the payments trigger runs
 * in the database, not here. This copy exists so the webapp can PREVIEW and
 * EXPLAIN a date (join flow, reminder emails, admin preview) without a round
 * trip. If the rule ever changes, change both, and update the parity test in
 * __tests__/lib/membership-expiration.test.ts that pins them to the same cases.
 *
 * Everything here is pure civil-date math on 'YYYY-MM-DD' strings. It never
 * constructs a Date from a bare date string: `new Date('2027-03-31')` is UTC
 * midnight and renders a day early west of Greenwich — the same trap
 * lib/date.ts exists to avoid.
 */

/** A civil date, 'YYYY-MM-DD'. */
export type CivilDate = string

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/** Members with this status are never given a computed expiration. */
export const LIFETIME_STATUS = 'lifetime'

export function isCivilDate(value: unknown): value is CivilDate {
  if (typeof value !== 'string' || !DATE_RE.test(value)) return false
  const [y, m, d] = value.split('-').map(Number)
  if (m < 1 || m > 12 || d < 1 || d > 31) return false
  return d <= daysInMonth(y, m)
}

function daysInMonth(year: number, month: number): number {
  // month is 1-based. Day 0 of the next month is the last day of this one.
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

/**
 * Add whole years to a civil date, clamping the day to the target month.
 * 2028-02-29 + 1 year → 2029-02-28, matching MySQL's DATE_ADD.
 */
export function addYears(date: CivilDate, years: number): CivilDate {
  const [y, m, d] = date.split('-').map(Number)
  const targetYear = y + years
  const day = Math.min(d, daysInMonth(targetYear, m))
  return `${String(targetYear).padStart(4, '0')}-${pad(m)}-${pad(day)}`
}

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

/**
 * The renewal rule.
 *
 * @param current The expiration being extended. `null` for a brand-new member
 *                who has never had one — they simply get anchor + years.
 * @param anchor  The date the renewal is measured from: the payment date for a
 *                real renewal, today for a preview.
 * @param years   config.MembershipRenewalYears (defaults to 1).
 *
 * An on-time renewer keeps their club-year date and gains a year. A lapsed
 * member gets anchor + years instead of being snapped backwards, which is the
 * entire point of the MAX().
 */
export function nextExpiration(
  current: CivilDate | null | undefined,
  anchor: CivilDate,
  years = 1,
): CivilDate {
  if (!isCivilDate(anchor)) {
    throw new Error(`nextExpiration: anchor must be YYYY-MM-DD, got ${String(anchor)}`)
  }
  const fromAnchor = addYears(anchor, years)
  if (!current || !isCivilDate(current)) return fromAnchor

  const fromCurrent = addYears(current, years)
  return fromCurrent > fromAnchor ? fromCurrent : fromAnchor
}

/**
 * Whole days from `from` to `to`, negative once `to` is in the past. Both dates
 * are treated as UTC midnight, so the difference is exact and DST-free — the
 * only safe way to count days between civil dates.
 */
export function daysBetween(from: CivilDate, to: CivilDate): number {
  const a = Date.parse(`${from}T00:00:00Z`)
  const b = Date.parse(`${to}T00:00:00Z`)
  return Math.round((b - a) / 86_400_000)
}

/** Today in New York, as a civil date — the club's timezone. */
export function todayInNY(now: Date = new Date()): CivilDate {
  // en-CA gives YYYY-MM-DD directly.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now)
}

/** Normalize whatever the driver hands back (Date | string | null) to a civil date. */
export function toCivilDate(value: Date | string | null | undefined): CivilDate | null {
  if (!value) return null
  if (value instanceof Date) {
    // mysql2 returns DATE columns as a local-midnight Date. Read the local
    // parts, not toISOString(), which would shift the day west of Greenwich.
    return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`
  }
  const candidate = String(value).slice(0, 10)
  return isCivilDate(candidate) ? candidate : null
}
