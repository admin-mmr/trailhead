/**
 * Render tests for the RSVP controls and roster panel.
 *
 * These cover the interactions a member actually performs — pick an intent,
 * change it, clear it, peek at the roster — plus the two states that are easy to
 * get wrong: a past race (no controls) and a roster where somebody opted out of
 * being named.
 */

import React from 'react'
import { render, screen, waitFor, act, fireEvent } from '@testing-library/react'
import RsvpControls from '@/app/(member)/portal/events/_components/RsvpControls'
import RosterPanel from '@/app/(member)/portal/events/_components/RosterPanel'
import { translations } from '@/lib/i18n/translations'

jest.mock('@/lib/i18n/context', () => ({
  useLang: () => ({
    lang: 'en',
    T: (key: keyof typeof translations) => translations[key].en,
  }),
}))

const okJson = (data: unknown) =>
  Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ ok: true, data }) })

beforeEach(() => jest.clearAllMocks())
afterEach(() => jest.restoreAllMocks())

describe('RsvpControls', () => {
  const setup = (props: Partial<React.ComponentProps<typeof RsvpControls>> = {}) => {
    const onChange = jest.fn()
    render(
      <RsvpControls
        eventId={320}
        intent={null}
        note={null}
        isPast={false}
        onChange={onChange}
        {...props}
      />
    )
    return onChange
  }

  it('POSTs the chosen intent and reports it upward', async () => {
    global.fetch = jest.fn(() => okJson({ intent: 'running', note: null })) as jest.Mock
    const onChange = setup()

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /I'm running/ }))
    })

    const [url, init] = (global.fetch as jest.Mock).mock.calls[0]
    expect(url).toBe('/api/events/320/rsvp')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body)).toEqual({ intent: 'running' })
    expect(onChange).toHaveBeenCalledWith({ intent: 'running', note: null })
  })

  it('marks the current intent as pressed for assistive tech', () => {
    setup({ intent: 'volunteering' })
    expect(screen.getByRole('button', { name: /I'm volunteering/ })).toHaveAttribute(
      'aria-pressed',
      'true'
    )
    expect(screen.getByRole('button', { name: /I'm running/ })).toHaveAttribute(
      'aria-pressed',
      'false'
    )
  })

  it('tapping the selected intent again DELETEs the RSVP', async () => {
    global.fetch = jest.fn(() => okJson({ removed: true })) as jest.Mock
    const onChange = setup({ intent: 'running' })

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /I'm running/ }))
    })

    expect((global.fetch as jest.Mock).mock.calls[0][1].method).toBe('DELETE')
    expect(onChange).toHaveBeenCalledWith({ intent: null, note: null })
  })

  it('switching intents POSTs the new one rather than deleting', async () => {
    global.fetch = jest.fn(() => okJson({ intent: 'volunteering', note: null })) as jest.Mock
    const onChange = setup({ intent: 'running' })

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /I'm volunteering/ }))
    })

    expect((global.fetch as jest.Mock).mock.calls[0][1].method).toBe('POST')
    expect(onChange).toHaveBeenCalledWith({ intent: 'volunteering', note: null })
  })

  it('sends the note along with the intent', async () => {
    global.fetch = jest.fn(() => okJson({ intent: 'running', note: 'pacing 3:30' })) as jest.Mock
    setup({ intent: 'running', note: null })

    fireEvent.change(screen.getByPlaceholderText(/Optional note/), {
      target: { value: 'pacing 3:30' },
    })
    await act(async () => {
      fireEvent.blur(screen.getByPlaceholderText(/Optional note/))
    })

    const body = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body)
    expect(body).toEqual({ intent: 'running', note: 'pacing 3:30' })
  })

  it('does not re-save an unchanged note on blur', async () => {
    global.fetch = jest.fn(() => okJson({})) as jest.Mock
    setup({ intent: 'running', note: 'pacing 3:30' })

    await act(async () => {
      fireEvent.blur(screen.getByPlaceholderText(/Optional note/))
    })

    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('hides the note field until an intent is chosen', () => {
    setup({ intent: null })
    expect(screen.queryByPlaceholderText(/Optional note/)).not.toBeInTheDocument()
  })

  it('shows an error and leaves state untouched when the save fails', async () => {
    global.fetch = jest.fn(() =>
      Promise.resolve({ ok: false, status: 409, json: () => Promise.resolve({ ok: false, error: 'nope' }) })
    ) as jest.Mock
    jest.spyOn(console, 'error').mockImplementation(() => {})
    const onChange = setup()

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /I'm running/ }))
    })

    expect(screen.getByText('Could not save your response.')).toBeInTheDocument()
    expect(onChange).not.toHaveBeenCalled()
  })

  it('survives an edge redirect that returns HTML instead of JSON', async () => {
    // A gated route 307s to /login; fetch follows it and res.ok is true, but
    // json() throws. That must surface as the error state, not an unhandled crash.
    global.fetch = jest.fn(() =>
      Promise.resolve({ ok: true, status: 200, json: () => Promise.reject(new SyntaxError('<!DOCTYPE')) })
    ) as jest.Mock
    jest.spyOn(console, 'error').mockImplementation(() => {})
    const onChange = setup()

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /I'm running/ }))
    })

    expect(screen.getByText('Could not save your response.')).toBeInTheDocument()
    expect(onChange).not.toHaveBeenCalled()
  })

  it('offers no controls for a race that already happened', () => {
    setup({ isPast: true })
    expect(screen.getByText('This race has already happened.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /I'm running/ })).not.toBeInTheDocument()
  })
})

describe('RosterPanel', () => {
  it('lists names grouped by intent', async () => {
    global.fetch = jest.fn(() =>
      okJson({
        running: [{ memberId: 'A1', name: 'Mei Chen', note: null }],
        volunteering: [{ memberId: 'A2', name: 'Sam Wu', note: 'water station' }],
        interested: [],
        counts: { running: 1, volunteering: 1, interested: 0, notGoing: 0 },
        hiddenCount: 0,
      })
    ) as jest.Mock

    await act(async () => {
      render(<RosterPanel eventId={320} />)
    })

    expect(screen.getByText('Mei Chen')).toBeInTheDocument()
    expect(screen.getByText(/Sam Wu/)).toBeInTheDocument()
    expect(screen.getByText(/water station/)).toBeInTheDocument()
  })

  it('explains counted-but-unnamed responders without naming them', async () => {
    global.fetch = jest.fn(() =>
      okJson({
        running: [{ memberId: 'A1', name: 'Mei Chen', note: null }],
        volunteering: [],
        interested: [],
        counts: { running: 3, volunteering: 0, interested: 0, notGoing: 0 },
        hiddenCount: 2,
      })
    ) as jest.Mock

    await act(async () => {
      render(<RosterPanel eventId={320} />)
    })

    // Count reflects all three; only one name is listed.
    expect(screen.getByText(/Running \(3\)/)).toBeInTheDocument()
    expect(screen.getByText(/2 members are counted but chose not to be listed/)).toBeInTheDocument()
  })

  it('uses the singular phrasing for exactly one hidden member', async () => {
    global.fetch = jest.fn(() =>
      okJson({
        running: [],
        volunteering: [],
        interested: [],
        counts: { running: 1, volunteering: 0, interested: 0, notGoing: 0 },
        hiddenCount: 1,
      })
    ) as jest.Mock

    await act(async () => {
      render(<RosterPanel eventId={320} />)
    })

    expect(
      screen.getByText('1 member is counted but chose not to be listed.')
    ).toBeInTheDocument()
  })

  it('invites the first responder when nobody has answered', async () => {
    global.fetch = jest.fn(() =>
      okJson({
        running: [],
        volunteering: [],
        interested: [],
        counts: { running: 0, volunteering: 0, interested: 0, notGoing: 0 },
        hiddenCount: 0,
      })
    ) as jest.Mock

    await act(async () => {
      render(<RosterPanel eventId={320} />)
    })

    expect(screen.getByText('Nobody has responded yet — be first.')).toBeInTheDocument()
  })

  it('shows an error state instead of hanging on a failed load', async () => {
    global.fetch = jest.fn(() => Promise.reject(new Error('offline'))) as jest.Mock
    jest.spyOn(console, 'error').mockImplementation(() => {})

    await act(async () => {
      render(<RosterPanel eventId={320} />)
    })

    await waitFor(() => {
      expect(screen.queryByText('Loading…')).not.toBeInTheDocument()
    })
    expect(screen.getByText('Could not load the roster.')).toBeInTheDocument()
  })
})
