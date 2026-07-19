// web-apps/mmr-webapp/lib/date.ts
//
// All date-only values in this app are YYYY-MM-DD strings (Expiration, PaymentDate, etc.).
// All datetime values are UTC ISO 8601 strings (Timestamp, ProcessedTime, etc.).
//
// Key gotcha: new Date("2026-03-31") is parsed as UTC midnight by browsers/Node.
// In New York (UTC-4) that's 8pm March 30 — wrong date.  Use parseLocalDate() instead.

// ─── Date-only helpers ────────────────────────────────────────────────────────

/**
 * Parse a YYYY-MM-DD string as local calendar midnight (avoids UTC-midnight shift).
 * Use instead of new Date("YYYY-MM-DD") anywhere a date-only value is involved.
 */
export function parseLocalDate(dateStr: string | null | undefined): Date | null {
  if (!dateStr) return null
  const m = dateStr.trim().match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!m) return null
  const d = new Date(+m[1], +m[2] - 1, +m[3]) // local midnight — no UTC shift
  // Reject rollover: new Date(2026, 98, 99) silently becomes a 2034 date
  if (d.getFullYear() !== +m[1] || d.getMonth() !== +m[2] - 1 || d.getDate() !== +m[3]) return null
  return d
}

/**
 * True if expiresAt (YYYY-MM-DD) is strictly before today in America/New_York.
 *
 * Uses Intl.DateTimeFormat to get today's NY date so it works correctly whether
 * the server/browser is in UTC or any other timezone.  Replaces the pattern:
 *   new Date(member.expiresAt) < new Date()
 * which fires 4-5 hours early for NY members (UTC-midnight vs local midnight).
 */
export function isExpiredNY(expiresAt: string | null | undefined): boolean {
  if (!expiresAt) return false
  // 'en-CA' locale gives YYYY-MM-DD format from Intl.DateTimeFormat
  const todayNY = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' })
    .format(new Date())
  return expiresAt.slice(0, 10) < todayNY
}

/**
 * Days until expiry (negative = already expired), computed in America/New_York.
 * Returns null if expiresAt is absent.
 */
export function daysUntilExpiryNY(expiresAt: string | null | undefined): number | null {
  if (!expiresAt) return null
  const todayNY = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' })
    .format(new Date())
  const expLocal = parseLocalDate(expiresAt)
  const todLocal = parseLocalDate(todayNY)
  if (!expLocal || !todLocal) return null
  return Math.ceil((expLocal.getTime() - todLocal.getTime()) / 86_400_000)
}

// ─── Display formatting ───────────────────────────────────────────────────────

/**
 * Format any date/datetime string for display in the given locale and timezone.
 *
 * For YYYY-MM-DD strings (date-only), parses as local calendar midnight so the
 * displayed date matches the stored value (not the UTC-shifted version).
 * For ISO 8601 datetime strings, converts to the given timeZone for display.
 */
export function formatLocaleDate(
  dateString: string | null | undefined,
  locale: string = 'en-US',
  timeZone: string = 'America/New_York'
): string {
  if (!dateString) return ''
  try {
    let date: Date
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateString.trim())) {
      // Date-only: parse as local midnight to avoid UTC-midnight off-by-one
      const d = parseLocalDate(dateString)
      if (!d) return dateString
      date = d
    } else {
      date = new Date(dateString)
    }
    if (isNaN(date.getTime())) return dateString
    return date.toLocaleDateString(locale, { timeZone })
  } catch (e) {
    console.error('Failed to format date', dateString, e)
    return dateString
  }
}
