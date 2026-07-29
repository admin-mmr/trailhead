'use client'

import { useLang } from '@/lib/i18n/context'
import type { CalendarEvent, RsvpIntent } from '@/lib/db/events'
import { groupByMonth, monthLabel } from './eventMeta'
import EventCard from './EventCard'

/**
 * Chronological, month-grouped list of races. Primary view on mobile, and the
 * place RSVP happens on every screen size — the month grid is a glance view.
 */
export default function EventList({
  events,
  today,
  onRsvpChange,
}: {
  events: CalendarEvent[]
  today: string
  onRsvpChange: (eventId: number, next: { intent: RsvpIntent | null; note: string | null }) => void
}) {
  const { lang } = useLang()

  return (
    <div className="space-y-8">
      {groupByMonth(events).map(({ key, events: monthEvents }) => (
        <section key={key}>
          <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-3">
            {monthLabel(key, lang)}
          </h2>

          <ul className="space-y-3">
            {monthEvents.map(event => (
              <EventCard
                key={event.id}
                event={event}
                today={today}
                onRsvpChange={onRsvpChange}
              />
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}
