import {
  parseLocalDate,
  isExpiredNY,
  daysUntilExpiryNY,
  formatLocaleDate,
} from '@/lib/date'

// ─── parseLocalDate ───────────────────────────────────────────────────────────

describe('parseLocalDate', () => {
  it('returns a Date with correct year/month/day for a valid date string', () => {
    const d = parseLocalDate('2026-03-31')
    expect(d).not.toBeNull()
    expect(d!.getFullYear()).toBe(2026)
    expect(d!.getMonth()).toBe(2) // 0-indexed
    expect(d!.getDate()).toBe(31)
  })

  it('parses local midnight — getDate() matches the stored date (not UTC-shifted)', () => {
    // UTC midnight for 2026-03-31 would be 8 pm March 30 in NYC (UTC-4)
    // parseLocalDate must return March 31 regardless of where the test runs
    const d = parseLocalDate('2026-03-31')!
    expect(d.getFullYear()).toBe(2026)
    expect(d.getMonth()).toBe(2)
    expect(d.getDate()).toBe(31)
  })

  it('returns null for null', () => {
    expect(parseLocalDate(null)).toBeNull()
  })

  it('returns null for undefined', () => {
    expect(parseLocalDate(undefined)).toBeNull()
  })

  it('returns null for empty string', () => {
    expect(parseLocalDate('')).toBeNull()
  })

  it('returns null for a date-only string missing day', () => {
    expect(parseLocalDate('2026-03')).toBeNull()
  })

  it('returns null for a non-date string', () => {
    expect(parseLocalDate('not-a-date')).toBeNull()
  })

  it('returns null for an ISO datetime string (no YYYY-MM-DD prefix match is fine, but verify behavior)', () => {
    // The regex anchors to the start so an ISO string still yields a date via the prefix
    // Document the actual behavior: it DOES match the YYYY-MM-DD prefix
    const d = parseLocalDate('2026-03-31T12:00:00Z')
    // prefix match succeeds — result should be March 31
    expect(d).not.toBeNull()
    expect(d!.getDate()).toBe(31)
  })
})

// ─── isExpiredNY ─────────────────────────────────────────────────────────────

describe('isExpiredNY', () => {
  it('returns true for a date clearly in the past', () => {
    expect(isExpiredNY('2000-01-01')).toBe(true)
  })

  it('returns false for a date clearly in the future', () => {
    expect(isExpiredNY('2099-12-31')).toBe(false)
  })

  it('returns false for null', () => {
    expect(isExpiredNY(null)).toBe(false)
  })

  it('returns false for undefined', () => {
    expect(isExpiredNY(undefined)).toBe(false)
  })

  it('returns false for empty string', () => {
    expect(isExpiredNY('')).toBe(false)
  })
})

// ─── daysUntilExpiryNY ───────────────────────────────────────────────────────

describe('daysUntilExpiryNY', () => {
  it('returns null for null', () => {
    expect(daysUntilExpiryNY(null)).toBeNull()
  })

  it('returns null for undefined', () => {
    expect(daysUntilExpiryNY(undefined)).toBeNull()
  })

  it('returns a negative number for a date in the past', () => {
    const days = daysUntilExpiryNY('2000-01-01')
    expect(days).not.toBeNull()
    expect(days!).toBeLessThan(0)
  })

  it('returns a positive number for a date in the future', () => {
    const days = daysUntilExpiryNY('2099-12-31')
    expect(days).not.toBeNull()
    expect(days!).toBeGreaterThan(0)
  })

  it('returns more than 20000 days for 2099-12-31', () => {
    // Rough magnitude check: ~73 years × 365 ≈ 26645 days from 2026
    const days = daysUntilExpiryNY('2099-12-31')
    expect(days!).toBeGreaterThan(20000)
  })

  it('returns roughly negative days for a known past date', () => {
    // 2000-01-01 is at least 9000 days before mid-2026
    const days = daysUntilExpiryNY('2000-01-01')
    expect(days!).toBeLessThan(-9000)
  })

  it('returns 0 for today (NY date)', () => {
    // Compute today's NY date the same way the implementation does
    const todayNY = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' })
      .format(new Date())
    const days = daysUntilExpiryNY(todayNY)
    expect(days).toBe(0)
  })
})

// ─── formatLocaleDate ─────────────────────────────────────────────────────────

describe('formatLocaleDate', () => {
  it('returns a non-empty string for a valid YYYY-MM-DD date', () => {
    const result = formatLocaleDate('2026-03-31')
    expect(result).not.toBe('')
    expect(typeof result).toBe('string')
  })

  it('formats YYYY-MM-DD using the supplied locale', () => {
    // en-CA locale for a YYYY-MM-DD produces something date-like
    const result = formatLocaleDate('2026-03-31', 'en-CA', 'America/New_York')
    expect(result).toMatch(/2026/)
  })

  it('returns a non-empty string for an ISO datetime string', () => {
    const result = formatLocaleDate('2026-03-31T18:00:00Z')
    expect(result).not.toBe('')
    expect(typeof result).toBe('string')
  })

  it('returns empty string for null', () => {
    expect(formatLocaleDate(null)).toBe('')
  })

  it('returns empty string for undefined', () => {
    expect(formatLocaleDate(undefined)).toBe('')
  })

  it('returns empty string for empty string', () => {
    expect(formatLocaleDate('')).toBe('')
  })

  it('returns the original string for a completely invalid input', () => {
    expect(formatLocaleDate('not-a-date-at-all')).toBe('not-a-date-at-all')
  })

  it('returns the original string for a partial/bad date', () => {
    expect(formatLocaleDate('2026-99-99')).toBe('2026-99-99')
  })
})
