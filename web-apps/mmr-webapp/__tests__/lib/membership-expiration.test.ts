/**
 * The renewal rule and the reminder cadence.
 *
 * The cases in `SQL_PARITY` are the contract with fn_next_expiration
 * (db/MIGRATION_V038.sql). If you change the rule in either place, these cases
 * must be updated in both — the SQL is what actually runs at payment time, this
 * copy is what the webapp shows members.
 */

import {
  addYears,
  daysBetween,
  isCivilDate,
  nextExpiration,
  toCivilDate,
  todayInNY,
} from '@/lib/membership/expiration'
import {
  REMINDER_MAX_DAYS,
  REMINDER_MIN_DAYS,
  RENEWAL_STAGES,
  reminderDedupeKey,
  stageDef,
  stageFor,
} from '@/lib/membership/renewal-stages'

describe('nextExpiration — max(current + 1yr, anchor + 1yr)', () => {
  const SQL_PARITY: Array<{
    name: string
    current: string | null
    anchor: string
    expected: string
  }> = [
    {
      // The on-time case: renewing while still active keeps the club-year date
      // and adds a year. This is what all 408 active members hit.
      name: 'on-time renewal extends the existing club-year date',
      current: '2027-03-31',
      anchor: '2026-11-15',
      expected: '2028-03-31',
    },
    {
      // The whole reason for the MAX: a lapsed member is not snapped backwards.
      name: 'lapsed member gets a full year from today, not the old date',
      current: '2026-03-31',
      anchor: '2026-07-30',
      expected: '2027-07-30',
    },
    {
      name: 'renewing on the expiration day itself gives current + 1 year',
      current: '2027-03-31',
      anchor: '2027-03-31',
      expected: '2028-03-31',
    },
    {
      name: 'brand-new member with no expiration gets anchor + 1 year',
      current: null,
      anchor: '2026-07-30',
      expected: '2027-07-30',
    },
    {
      // MySQL DATE_ADD clamps Feb 29 → Feb 28; addYears must agree.
      name: 'leap day clamps to Feb 28',
      current: '2028-02-29',
      anchor: '2027-01-01',
      expected: '2029-02-28',
    },
    {
      name: 'a far-future expiration (lifetime-like) is never shortened',
      current: '2126-03-31',
      anchor: '2026-07-30',
      expected: '2127-03-31',
    },
  ]

  it.each(SQL_PARITY)('$name', ({ current, anchor, expected }) => {
    expect(nextExpiration(current, anchor)).toBe(expected)
  })

  it('is monotonic — the result is never earlier than the current expiration', () => {
    const anchors = ['2026-01-01', '2026-07-30', '2027-03-31', '2030-12-31']
    const currents = ['2026-03-31', '2027-03-31', '2028-06-15']
    for (const anchor of anchors) {
      for (const current of currents) {
        expect(nextExpiration(current, anchor) > current).toBe(true)
      }
    }
  })

  it('always grants at least a year from the anchor', () => {
    expect(nextExpiration('2020-01-01', '2026-07-30')).toBe('2027-07-30')
  })

  it('honours a multi-year renewal length', () => {
    expect(nextExpiration('2027-03-31', '2026-11-15', 2)).toBe('2029-03-31')
    expect(nextExpiration(null, '2026-11-15', 2)).toBe('2028-11-15')
  })

  it('treats a malformed current expiration as absent rather than throwing', () => {
    expect(nextExpiration('not-a-date', '2026-07-30')).toBe('2027-07-30')
    expect(nextExpiration('2026-02-30', '2026-07-30')).toBe('2027-07-30')
  })

  it('rejects a malformed anchor — silently guessing a renewal date is worse', () => {
    expect(() => nextExpiration('2027-03-31', 'tomorrow')).toThrow(/anchor/)
  })
})

describe('civil-date helpers', () => {
  it('validates real calendar days only', () => {
    expect(isCivilDate('2026-02-28')).toBe(true)
    expect(isCivilDate('2024-02-29')).toBe(true)   // leap year
    expect(isCivilDate('2026-02-29')).toBe(false)  // not a leap year
    expect(isCivilDate('2026-13-01')).toBe(false)
    expect(isCivilDate('2026-7-30')).toBe(false)   // unpadded
    expect(isCivilDate('')).toBe(false)
    expect(isCivilDate(null)).toBe(false)
  })

  it('counts days without DST drift across a spring-forward boundary', () => {
    // 2026-03-08 is the US DST transition; a naive local-time subtraction
    // would return 0.958… days here and round wrong.
    expect(daysBetween('2026-03-07', '2026-03-09')).toBe(2)
    expect(daysBetween('2026-07-30', '2026-07-30')).toBe(0)
    expect(daysBetween('2026-07-30', '2026-07-29')).toBe(-1)
    expect(daysBetween('2026-01-01', '2027-01-01')).toBe(365)
  })

  it('reads a mysql2 Date back as the same calendar day, not the day before', () => {
    // The trap this exists for: a DATE column arrives as local midnight, and
    // toISOString() would move it back a day anywhere west of Greenwich.
    const localMidnight = new Date(2027, 2, 31) // 2027-03-31 local
    expect(toCivilDate(localMidnight)).toBe('2027-03-31')
    expect(toCivilDate('2027-03-31T00:00:00.000Z')).toBe('2027-03-31')
    expect(toCivilDate(null)).toBeNull()
    expect(toCivilDate('')).toBeNull()
  })

  it('addYears clamps end-of-month correctly', () => {
    expect(addYears('2024-02-29', 1)).toBe('2025-02-28')
    expect(addYears('2026-01-31', 1)).toBe('2027-01-31')
    expect(addYears('2026-12-31', 4)).toBe('2030-12-31')
  })

  it('todayInNY returns a valid civil date', () => {
    expect(isCivilDate(todayInNY())).toBe(true)
    // 2026-07-30 03:00 UTC is still 2026-07-29 in New York.
    expect(todayInNY(new Date('2026-07-30T03:00:00Z'))).toBe('2026-07-29')
  })
})

describe('renewal stage bands', () => {
  it('covers every day between the widest bounds with exactly one stage', () => {
    for (let day = REMINDER_MIN_DAYS; day <= REMINDER_MAX_DAYS; day += 1) {
      const matches = RENEWAL_STAGES.filter(
        (s) => day >= s.minDays && day <= s.maxDays,
      )
      expect(matches).toHaveLength(1)
    }
  })

  it('has no band narrower than the weekly job interval', () => {
    // A band shorter than 7 days could be stepped over entirely by a weekly run,
    // and that member would never receive that stage.
    for (const stage of RENEWAL_STAGES) {
      expect(stage.maxDays - stage.minDays + 1).toBeGreaterThanOrEqual(15)
    }
  })

  it('maps representative days to the intended stage', () => {
    expect(stageFor(70)?.stage).toBe('T60')
    expect(stageFor(46)?.stage).toBe('T60')
    expect(stageFor(45)?.stage).toBe('T30')
    expect(stageFor(15)?.stage).toBe('T30')
    expect(stageFor(14)?.stage).toBe('T7')
    expect(stageFor(0)?.stage).toBe('T7')     // expires today
    expect(stageFor(-1)?.stage).toBe('LAPSED_14')
    expect(stageFor(-21)?.stage).toBe('LAPSED_14')
    expect(stageFor(-22)?.stage).toBe('FINAL_45')
    expect(stageFor(-75)?.stage).toBe('FINAL_45')
  })

  it('stops outside the bands — too early to nag, or long gone', () => {
    expect(stageFor(76)).toBeNull()
    expect(stageFor(400)).toBeNull()
    expect(stageFor(-76)).toBeNull()
    // A member expired 2026-03-31 seen today is ~486 days out: no mail.
    expect(stageFor(-486)).toBeNull()
    expect(stageFor(Number.NaN)).toBeNull()
  })

  it('dedupe keys include the expiration so renewing starts a fresh cycle', () => {
    const before = reminderDedupeKey('A0123', '2027-03-31', 'T30')
    const after = reminderDedupeKey('A0123', '2028-03-31', 'T30')
    expect(before).not.toBe(after)
    expect(before).toBe('renewal:A0123:2027-03-31:T30')
  })

  it('stageDef rejects an unknown stage rather than returning undefined', () => {
    expect(stageDef('T30').label).toBeTruthy()
    // @ts-expect-error — deliberately invalid, guards against a typo at runtime
    expect(() => stageDef('T31')).toThrow(/Unknown renewal stage/)
  })
})
