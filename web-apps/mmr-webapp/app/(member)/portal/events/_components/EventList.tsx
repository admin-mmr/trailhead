'use client'

import { MapPin, Ruler, Wifi, Users, HandHeart, ExternalLink } from 'lucide-react'
import { useLang } from '@/lib/i18n/context'
import { formatLongDate } from '@/lib/date'
import type { CalendarEvent } from '@/lib/db/events'
import { distanceLabel, groupByMonth, monthLabel, myIntentClass, myIntentKey } from './eventMeta'

/**
 * Chronological, month-grouped list of races. Primary view on mobile; also the
 * fallback whenever the month grid would be awkward (long event names, many
 * races on one day).
 */
export default function EventList({
  events,
  today,
}: {
  events: CalendarEvent[]
  today: string
}) {
  const { lang, T } = useLang()
  const locale = lang === 'zh' ? 'zh-CN' : 'en-US'

  return (
    <div className="space-y-8">
      {groupByMonth(events).map(({ key, events: monthEvents }) => (
        <section key={key}>
          <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-3">
            {monthLabel(key, lang)}
          </h2>

          <ul className="space-y-3">
            {monthEvents.map(event => {
              const isPast = event.eventDate < today
              const distance = distanceLabel(event, lang)
              const intentKey = myIntentKey(event.myIntent)

              return (
                <li
                  key={event.id}
                  className={`bg-white rounded-2xl border border-gray-100 p-4 ${isPast ? 'opacity-60' : ''}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-xs font-medium text-brand-orange mb-1">
                        {/* Date-only value — formatLongDate avoids the UTC-midnight day-early shift */}
                        {formatLongDate(event.eventDate, locale)}
                      </p>
                      <h3 className="font-semibold text-[#0A2342] leading-snug">
                        {event.eventName}
                      </h3>

                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-2 text-xs text-gray-500">
                        {event.location && (
                          <span className="inline-flex items-center gap-1">
                            <MapPin className="w-3.5 h-3.5" aria-hidden="true" />
                            {event.location}
                          </span>
                        )}
                        {distance && (
                          <span className="inline-flex items-center gap-1">
                            <Ruler className="w-3.5 h-3.5" aria-hidden="true" />
                            {distance}
                          </span>
                        )}
                        {event.isVirtual && (
                          <span className="inline-flex items-center gap-1">
                            <Wifi className="w-3.5 h-3.5" aria-hidden="true" />
                            {T('cal.virtual')}
                          </span>
                        )}
                      </div>
                    </div>

                    {intentKey && (
                      <span
                        className={`flex-shrink-0 text-xs font-medium px-2.5 py-1 rounded-full ${myIntentClass(event.myIntent)}`}
                      >
                        {T(intentKey)}
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-4 mt-3 pt-3 border-t border-gray-100 text-xs text-gray-500">
                    <span className="inline-flex items-center gap-1.5">
                      <Users className="w-3.5 h-3.5" aria-hidden="true" />
                      {event.runningCount} {T('cal.running')}
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                      <HandHeart className="w-3.5 h-3.5" aria-hidden="true" />
                      {event.volunteeringCount} {T('cal.volunteering')}
                    </span>
                    {event.eventUrl && (
                      <a
                        href={event.eventUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="ml-auto inline-flex items-center gap-1 text-brand-navy hover:underline"
                      >
                        {T('cal.details')}
                        <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" />
                      </a>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
        </section>
      ))}
    </div>
  )
}
