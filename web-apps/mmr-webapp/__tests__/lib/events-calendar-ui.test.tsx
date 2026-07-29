/**
 * Render tests for the member race calendar UI
 * app/(member)/portal/events/EventsCalendarClient.tsx
 *
 * Strategy: mock global.fetch, render, assert on what a member would see.
 * Covers the states that are hard to reach by hand — the empty window (the
 * normal state for far-future months, since NYRR publishes ~8 weeks out), a
 * failed load, and the date rendering that must not shift a day.
 */

import React from 'react'
import { render, screen, waitFor, act, fireEvent } from '@testing-library/react'
import EventsCalendarClient from '@/app/(member)/portal/events/EventsCalendarClient'
import { translations } from '@/lib/i18n/translations'

let mockLang: 'en' | 'zh' = 'en'

jest.mock('@/lib/i18n/context', () => ({
  useLang: () => ({
    lang: mockLang,
    T: (key: keyof typeof translations) => translations[key][mockLang],
  }),
}))

const makeEvent = (over: object = {}) => ({
  id: 320,
  eventCode: 'nyrr-summer-speed-series',
  eventName: 'NYRR Summer Speed Series #1',
  eventDate: '2026-08-05',
  location: 'New York',
  distance: null,
  distanceKm: null,
  isVirtual: false,
  eventUrl: 'https://www.nyrr.org/races/x',
  myIntent: null,
  myNote: null,
  runningCount: 0,
  volunteeringCount: 0,
  interestedCount: 0,
  ...over,
})

const respond = (data: object) =>
  Promise.resolve({
    ok: true,
    json: () => Promise.resolve({ ok: true, data: { from: '2026-07-01', to: '2026-11-01', clamped: false, latestKnownEventDate: '2026-11-01', events: [], ...data } }),
  })

beforeEach(() => {
  mockLang = 'en'
  jest.useFakeTimers().setSystemTime(new Date('2026-08-10T15:00:00Z'))
})

afterEach(() => {
  jest.useRealTimers()
  jest.restoreAllMocks()
})

async function renderCalendar(data: object) {
  global.fetch = jest.fn(() => respond(data)) as jest.Mock
  await act(async () => {
    render(<EventsCalendarClient />)
  })
}

describe('race calendar — happy path', () => {
  it('renders the event name and its RSVP counts', async () => {
    await renderCalendar({ events: [makeEvent({ runningCount: 4, volunteeringCount: 2 })] })

    // List view is always rendered (it's the mobile primary view).
    expect(screen.getAllByText('NYRR Summer Speed Series #1').length).toBeGreaterThan(0)
    expect(screen.getByText(/4 Running/)).toBeInTheDocument()
    expect(screen.getByText(/2 Volunteering/)).toBeInTheDocument()
  })

  it('renders the stored calendar date, not a UTC-shifted one', async () => {
    // The bug guarded here: new Date('2026-08-05') is UTC midnight, which
    // renders as August 4 anywhere west of Greenwich.
    await renderCalendar({ events: [makeEvent({ eventDate: '2026-08-05' })] })
    expect(screen.getByText('August 5, 2026')).toBeInTheDocument()
    expect(screen.queryByText('August 4, 2026')).not.toBeInTheDocument()
  })

  it('omits the distance field entirely when NYRR has not published one', async () => {
    // True of every currently-listed upcoming race — must not print "null".
    await renderCalendar({ events: [makeEvent({ distance: null, distanceKm: null })] })
    expect(screen.queryByText(/null/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/km/)).not.toBeInTheDocument()
  })

  it('shows a km fallback when only distance_km is known', async () => {
    await renderCalendar({ events: [makeEvent({ distance: null, distanceKm: 10 })] })
    expect(screen.getByText('10 km')).toBeInTheDocument()
  })

  it('badges the member’s own intent', async () => {
    await renderCalendar({ events: [makeEvent({ myIntent: 'volunteering' })] })
    expect(screen.getAllByText("You're volunteering").length).toBeGreaterThan(0)
  })

  it('links to the NYRR race page in a safe new tab', async () => {
    await renderCalendar({ events: [makeEvent()] })
    const link = screen.getByRole('link', { name: /Race details/ })
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', 'noopener noreferrer')
  })
})

describe('race calendar — empty and failure states', () => {
  it('explains an empty window as NYRR’s publication lag, not an error', async () => {
    await renderCalendar({ events: [] })
    expect(screen.getAllByText('No races in this window.').length).toBeGreaterThan(0)
    expect(screen.getAllByText(/eight weeks ahead/).length).toBeGreaterThan(0)
  })

  it('names the latest race it knows about in the empty state', async () => {
    await renderCalendar({ events: [], latestKnownEventDate: '2026-11-01' })
    expect(screen.getAllByText(/November 1, 2026/).length).toBeGreaterThan(0)
  })

  it('shows a retry affordance when the request fails', async () => {
    global.fetch = jest.fn(() =>
      Promise.resolve({ ok: false, status: 500, json: () => Promise.resolve({ ok: false }) })
    ) as jest.Mock
    jest.spyOn(console, 'error').mockImplementation(() => {})

    await act(async () => {
      render(<EventsCalendarClient />)
    })

    expect(screen.getByText('Could not load the calendar.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
  })

  it('does not leave a spinner up after a network rejection', async () => {
    global.fetch = jest.fn(() => Promise.reject(new Error('offline'))) as jest.Mock
    jest.spyOn(console, 'error').mockImplementation(() => {})

    await act(async () => {
      render(<EventsCalendarClient />)
    })

    await waitFor(() => {
      expect(screen.queryByText('Loading…')).not.toBeInTheDocument()
    })
    expect(screen.getByText('Could not load the calendar.')).toBeInTheDocument()
  })
})

describe('race calendar — navigation', () => {
  it('requests a new window when stepping to the next month', async () => {
    await renderCalendar({ events: [makeEvent()] })
    const calls = (global.fetch as jest.Mock).mock.calls.length

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Next month' }))
    })

    expect((global.fetch as jest.Mock).mock.calls.length).toBeGreaterThan(calls)
    const lastUrl = (global.fetch as jest.Mock).mock.calls.at(-1)[0] as string
    expect(lastUrl).toMatch(/^\/api\/events\/calendar\?from=\d{4}-\d{2}-\d{2}&to=\d{4}-\d{2}-\d{2}$/)
  })

  it('renders Chinese copy when the language is zh', async () => {
    mockLang = 'zh'
    await renderCalendar({ events: [makeEvent()] })
    expect(screen.getByText('赛事日历')).toBeInTheDocument()
  })
})
