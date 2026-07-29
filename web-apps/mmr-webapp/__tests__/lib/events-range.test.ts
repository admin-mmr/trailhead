/**
 * Unit tests for lib/events-range.ts — civil-date arithmetic and range clamping
 * for the member race calendar.
 *
 * These are the functions that decide which window the calendar asks for, so an
 * off-by-one here silently hides races from members. All inputs/outputs are
 * 'YYYY-MM-DD' strings; nothing may round-trip through a UTC instant.
 */

import {
  MAX_RANGE_DAYS,
  addDays,
  addMonths,
  daysBetween,
  isValidDateStr,
  resolveRange,
  todayNY,
} from '@/lib/events-range'

describe('addMonths', () => {
  it('shifts forward and backward within a year', () => {
    expect(addMonths('2026-07-29', 1)).toBe('2026-08-29')
    expect(addMonths('2026-07-29', -1)).toBe('2026-06-29')
  })

  it('crosses year boundaries in both directions', () => {
    expect(addMonths('2026-11-15', 3)).toBe('2027-02-15')
    expect(addMonths('2026-01-15', -1)).toBe('2025-12-15')
    expect(addMonths('2026-01-15', -13)).toBe('2024-12-15')
  })

  it('clamps the day to the target month instead of rolling over', () => {
    // The bug this prevents: Jan 31 + 1 month landing in March.
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28')
    expect(addMonths('2026-03-31', -1)).toBe('2026-02-28')
    expect(addMonths('2026-05-31', 1)).toBe('2026-06-30')
  })

  it('respects leap years when clamping', () => {
    expect(addMonths('2028-01-31', 1)).toBe('2028-02-29')
  })

  it('is a no-op for zero', () => {
    expect(addMonths('2026-07-29', 0)).toBe('2026-07-29')
  })
})

describe('addDays', () => {
  it('crosses month and year boundaries', () => {
    expect(addDays('2026-08-30', 3)).toBe('2026-09-02')
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31')
  })

  it('does not drift across a US DST transition', () => {
    // 2026-03-08 is the US spring-forward date; naive local-time arithmetic
    // loses or gains an hour here and can land on the wrong calendar day.
    expect(addDays('2026-03-07', 1)).toBe('2026-03-08')
    expect(addDays('2026-03-08', 1)).toBe('2026-03-09')
    expect(addDays('2026-11-01', 1)).toBe('2026-11-02')
  })

  it('handles leap day', () => {
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29')
    expect(addDays('2028-02-29', 1)).toBe('2028-03-01')
  })
})

describe('daysBetween', () => {
  it('counts forward, backward and same-day', () => {
    expect(daysBetween('2026-08-01', '2026-08-08')).toBe(7)
    expect(daysBetween('2026-08-08', '2026-08-01')).toBe(-7)
    expect(daysBetween('2026-08-01', '2026-08-01')).toBe(0)
  })

  it('spans a DST transition without a half-day rounding error', () => {
    expect(daysBetween('2026-03-01', '2026-04-01')).toBe(31)
    expect(daysBetween('2026-10-15', '2026-11-15')).toBe(31)
  })
})

describe('isValidDateStr', () => {
  it('accepts well-formed real dates', () => {
    expect(isValidDateStr('2026-08-05')).toBe(true)
    expect(isValidDateStr('2028-02-29')).toBe(true)
  })

  it('rejects impossible and malformed values', () => {
    expect(isValidDateStr('2026-02-31')).toBe(false)
    expect(isValidDateStr('2026-13-01')).toBe(false)
    expect(isValidDateStr('2027-02-29')).toBe(false) // not a leap year
    expect(isValidDateStr('08/05/2026')).toBe(false)
    expect(isValidDateStr('2026-8-5')).toBe(false)
    expect(isValidDateStr('')).toBe(false)
    expect(isValidDateStr(null)).toBe(false)
    expect(isValidDateStr(undefined)).toBe(false)
    expect(isValidDateStr(20260805)).toBe(false)
  })
})

describe('resolveRange', () => {
  const TODAY = '2026-07-29'

  it('defaults to one month back and three months forward', () => {
    // Session-1 finding: NYRR publishes ~8 weeks out, so a window ending at
    // "today" would routinely render an empty calendar.
    expect(resolveRange(null, null, TODAY)).toEqual({
      from: '2026-06-29',
      to: '2026-10-29',
      clamped: false,
    })
  })

  it('honors explicit valid params', () => {
    expect(resolveRange('2026-08-01', '2026-09-30', TODAY)).toEqual({
      from: '2026-08-01',
      to: '2026-09-30',
      clamped: false,
    })
  })

  it('falls back per-side when only one param is valid', () => {
    expect(resolveRange('2026-08-01', null, TODAY)).toEqual({
      from: '2026-08-01',
      to: '2026-10-29',
      clamped: false,
    })
    expect(resolveRange(null, '2026-09-30', TODAY)).toEqual({
      from: '2026-06-29',
      to: '2026-09-30',
      clamped: false,
    })
  })

  it('ignores malformed dates rather than passing them to SQL', () => {
    expect(resolveRange('not-a-date', '2026-02-31', TODAY)).toEqual({
      from: '2026-06-29',
      to: '2026-10-29',
      clamped: false,
    })
  })

  it('clamps a span wider than MAX_RANGE_DAYS and reports it', () => {
    const res = resolveRange('2026-01-01', '2030-01-01', TODAY)
    expect(res.from).toBe('2026-01-01')
    expect(res.clamped).toBe(true)
    expect(daysBetween(res.from, res.to)).toBe(MAX_RANGE_DAYS)
  })

  it('leaves a span exactly at the limit alone', () => {
    const to = addDays('2026-01-01', MAX_RANGE_DAYS)
    expect(resolveRange('2026-01-01', to, TODAY)).toEqual({
      from: '2026-01-01',
      to,
      clamped: false,
    })
  })

  it('throws 400 when from is later than to instead of silently swapping', () => {
    expect.assertions(2)
    try {
      resolveRange('2026-09-01', '2026-08-01', TODAY)
    } catch (err) {
      expect((err as { status?: number }).status).toBe(400)
      expect((err as Error).message).toMatch(/from/i)
    }
  })

  it('accepts an identical from/to (single day)', () => {
    expect(resolveRange('2026-08-05', '2026-08-05', TODAY)).toEqual({
      from: '2026-08-05',
      to: '2026-08-05',
      clamped: false,
    })
  })
})

describe('todayNY', () => {
  it('returns a valid YYYY-MM-DD civil date', () => {
    const today = todayNY()
    expect(today).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(isValidDateStr(today)).toBe(true)
  })

  it('reports the New York date, not the UTC date, late in the UTC day', () => {
    // 2026-07-30T02:00Z is still July 29 in New York (UTC-4).
    jest.useFakeTimers().setSystemTime(new Date('2026-07-30T02:00:00Z'))
    try {
      expect(todayNY()).toBe('2026-07-29')
    } finally {
      jest.useRealTimers()
    }
  })
})
