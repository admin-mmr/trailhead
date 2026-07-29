'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { CalendarDays, List, AlertCircle, ChevronLeft, ChevronRight } from 'lucide-react'
import { useLang } from '@/lib/i18n/context'
import { formatLongDate } from '@/lib/date'
import { addMonths, todayNY } from '@/lib/events-range'
import type { CalendarEvent, RsvpIntent } from '@/lib/db/events'
import EventList from './_components/EventList'
import MonthGrid from './_components/MonthGrid'
import { monthKey, monthLabel } from './_components/eventMeta'

interface CalendarPayload {
  from: string
  to: string
  clamped: boolean
  latestKnownEventDate: string | null
  events: CalendarEvent[]
}

/** Window to request around an anchor month: one month back, three forward. */
function windowFor(anchor: string): { from: string; to: string } {
  const anchorStart = `${anchor}-01`
  return { from: addMonths(anchorStart, -1), to: addMonths(anchorStart, 4) }
}

export default function EventsCalendarClient() {
  const { lang, T } = useLang()
  const locale = lang === 'zh' ? 'zh-CN' : 'en-US'
  const today = useMemo(() => todayNY(), [])

  const [anchor, setAnchor] = useState(() => monthKey(todayNY()))
  const [view, setView] = useState<'month' | 'list'>('month')
  const [payload, setPayload] = useState<CalendarPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)

  const load = useCallback(async (targetAnchor: string, signal?: AbortSignal) => {
    setLoading(true)
    setFailed(false)
    const { from, to } = windowFor(targetAnchor)
    try {
      const res = await fetch(`/api/events/calendar?from=${from}&to=${to}`, { signal })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = await res.json()
      if (!json?.ok) throw new Error(json?.error ?? 'Request failed')
      setPayload(json.data as CalendarPayload)
    } catch (err) {
      if ((err as Error)?.name === 'AbortError') return
      console.error('[calendar] load failed:', err)
      setFailed(true)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    const ctrl = new AbortController()
    load(anchor, ctrl.signal)
    return () => ctrl.abort()
  }, [anchor, load])

  // Memoized so the `?? []` fallback isn't a new array identity every render,
  // which would defeat the monthEvents memo below.
  const events = useMemo(() => payload?.events ?? [], [payload])
  const monthEvents = useMemo(
    () => events.filter(e => monthKey(e.eventDate) === anchor),
    [events, anchor]
  )

  const shiftMonth = (delta: number) => setAnchor(monthKey(addMonths(`${anchor}-01`, delta)))

  /**
   * Apply an RSVP change locally instead of refetching the window: the server
   * has already committed it, and adjusting the affected counter keeps the
   * numbers honest without a round-trip that would also reset scroll position.
   */
  const handleRsvpChange = (
    eventId: number,
    next: { intent: RsvpIntent | null; note: string | null }
  ) => {
    setPayload(prev => {
      if (!prev) return prev
      return {
        ...prev,
        events: prev.events.map(event => {
          if (event.id !== eventId) return event
          const delta = (from: RsvpIntent | null, key: RsvpIntent) =>
            (next.intent === key ? 1 : 0) - (from === key ? 1 : 0)
          return {
            ...event,
            myIntent: next.intent,
            myNote: next.note,
            runningCount: event.runningCount + delta(event.myIntent, 'running'),
            volunteeringCount: event.volunteeringCount + delta(event.myIntent, 'volunteering'),
            interestedCount: event.interestedCount + delta(event.myIntent, 'interested'),
          }
        }),
      }
    })
  }

  return (
    <div className="max-w-4xl mx-auto">
      <header className="mb-6">
        <h1 className="text-2xl font-bold text-[#0A2342]">{T('cal.title')}</h1>
        <p className="text-gray-600 text-sm mt-1">{T('cal.subtitle')}</p>
      </header>

      <div className="flex items-center gap-2 mb-5">
        <ViewToggle active={view === 'month'} onClick={() => setView('month')} label={T('cal.viewMonth')} icon={CalendarDays} />
        <ViewToggle active={view === 'list'} onClick={() => setView('list')} label={T('cal.viewList')} icon={List} />

        {anchor !== monthKey(today) && (
          <button
            type="button"
            onClick={() => setAnchor(monthKey(today))}
            className="ml-auto text-xs font-medium text-brand-navy hover:underline"
          >
            {T('cal.today')}
          </button>
        )}
      </div>

      {loading && <p className="text-sm text-gray-500 py-12 text-center">{T('common.loading')}</p>}

      {!loading && failed && (
        <div className="bg-red-50 border border-red-100 rounded-2xl p-5 text-center">
          <AlertCircle className="w-6 h-6 text-red-500 mx-auto mb-2" aria-hidden="true" />
          <p className="text-sm text-red-800 mb-3">{T('cal.loadFailed')}</p>
          <button
            type="button"
            onClick={() => load(anchor)}
            className="text-sm font-medium text-brand-navy hover:underline"
          >
            {T('cal.retry')}
          </button>
        </div>
      )}

      {!loading && !failed && view === 'month' && (
        <>
          {/* Month nav sits here, not in MonthGrid — the grid is hidden below lg,
              and nav nested inside it would be unreachable on mobile. */}
          <div className="flex items-center justify-between mb-4">
            <button
              type="button"
              onClick={() => shiftMonth(-1)}
              aria-label={T('cal.prevMonth')}
              className="p-2 rounded-xl text-gray-500 hover:bg-gray-100 hover:text-brand-navy transition-colors"
            >
              <ChevronLeft className="w-5 h-5" aria-hidden="true" />
            </button>
            <h2 className="text-lg font-semibold text-[#0A2342]">{monthLabel(anchor, lang)}</h2>
            <button
              type="button"
              onClick={() => shiftMonth(1)}
              aria-label={T('cal.nextMonth')}
              className="p-2 rounded-xl text-gray-500 hover:bg-gray-100 hover:text-brand-navy transition-colors"
            >
              <ChevronRight className="w-5 h-5" aria-hidden="true" />
            </button>
          </div>

          <div className="hidden lg:block mb-6">
            <MonthGrid monthKey={anchor} events={monthEvents} today={today} />
          </div>

          {/* The card list is where RSVP lives, so it renders in month view too —
              otherwise a desktop member looking at the grid could not respond. */}
          {monthEvents.length > 0 ? (
            <EventList events={monthEvents} today={today} onRsvpChange={handleRsvpChange} />
          ) : (
            <EmptyState latestKnownEventDate={payload?.latestKnownEventDate ?? null} locale={locale} />
          )}
        </>
      )}

      {!loading && !failed && view === 'list' && (
        events.length > 0 ? (
          <EventList events={events} today={today} onRsvpChange={handleRsvpChange} />
        ) : (
          <EmptyState latestKnownEventDate={payload?.latestKnownEventDate ?? null} locale={locale} />
        )
      )}
    </div>
  )
}

function ViewToggle({
  active, onClick, label, icon: Icon,
}: {
  active: boolean
  onClick: () => void
  label: string
  icon: typeof CalendarDays
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-xl transition-colors ${
        active ? 'bg-brand-navy text-white' : 'text-gray-600 hover:bg-gray-100'
      }`}
    >
      <Icon className="w-3.5 h-3.5" aria-hidden="true" />
      {label}
    </button>
  )
}

/**
 * An empty or short calendar is the normal state, not a failure: NYRR publishes
 * only ~8 weeks ahead. Say so, and name the last race we actually know about.
 */
function EmptyState({
  latestKnownEventDate, locale,
}: {
  latestKnownEventDate: string | null
  locale: string
}) {
  const { T } = useLang()
  return (
    <div className="text-center py-12 px-4">
      <CalendarDays className="w-8 h-8 text-gray-300 mx-auto mb-3" aria-hidden="true" />
      <p className="text-gray-600 font-medium">{T('cal.noEvents')}</p>
      <p className="text-gray-500 text-sm mt-2 max-w-sm mx-auto">{T('cal.noEventsHint')}</p>
      {latestKnownEventDate && (
        <p className="text-gray-400 text-xs mt-3">
          {T('cal.lastKnown')} {formatLongDate(latestKnownEventDate, locale)}
        </p>
      )}
    </div>
  )
}
