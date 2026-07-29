'use client'

import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useLang } from '@/lib/i18n/context'
import type { CalendarEvent } from '@/lib/db/events'
import { monthGridDays, monthLabel, myIntentClass } from './eventMeta'

const WEEKDAYS = {
  en: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
  zh: ['日', '一', '二', '三', '四', '五', '六'],
}

/**
 * Desktop month grid. Renders one anchor month; days with races show a chip per
 * race, tinted by the caller's own RSVP so their own commitments stand out.
 */
export default function MonthGrid({
  monthKey: anchor,
  events,
  today,
  onPrev,
  onNext,
}: {
  monthKey: string
  events: CalendarEvent[]
  today: string
  onPrev: () => void
  onNext: () => void
}) {
  const { lang, T } = useLang()

  // Bucket the month's events by date once, rather than filtering per cell.
  const byDate = new Map<string, CalendarEvent[]>()
  for (const event of events) {
    const list = byDate.get(event.eventDate)
    if (list) list.push(event)
    else byDate.set(event.eventDate, [event])
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <button
          type="button"
          onClick={onPrev}
          aria-label={T('cal.prevMonth')}
          className="p-2 rounded-xl text-gray-500 hover:bg-gray-100 hover:text-brand-navy transition-colors"
        >
          <ChevronLeft className="w-5 h-5" aria-hidden="true" />
        </button>

        <h2 className="text-lg font-semibold text-[#0A2342]">{monthLabel(anchor, lang)}</h2>

        <button
          type="button"
          onClick={onNext}
          aria-label={T('cal.nextMonth')}
          className="p-2 rounded-xl text-gray-500 hover:bg-gray-100 hover:text-brand-navy transition-colors"
        >
          <ChevronRight className="w-5 h-5" aria-hidden="true" />
        </button>
      </div>

      <div className="grid grid-cols-7 gap-px bg-gray-100 rounded-2xl overflow-hidden border border-gray-100">
        {(lang === 'zh' ? WEEKDAYS.zh : WEEKDAYS.en).map(day => (
          <div key={day} className="bg-gray-50 py-2 text-center text-xs font-semibold text-gray-500">
            {day}
          </div>
        ))}

        {monthGridDays(anchor).map((date, i) => {
          if (!date) return <div key={`pad-${i}`} className="bg-gray-50/60 min-h-[92px]" />

          const dayEvents = byDate.get(date) ?? []
          const isToday = date === today

          return (
            <div key={date} className="bg-white min-h-[92px] p-1.5 align-top">
              <span
                className={
                  isToday
                    ? 'inline-flex items-center justify-center w-6 h-6 rounded-full bg-brand-navy text-white text-xs font-semibold'
                    : 'inline-block w-6 text-center text-xs font-medium text-gray-400'
                }
              >
                {Number(date.slice(8, 10))}
              </span>

              <div className="mt-1 space-y-1">
                {dayEvents.map(event => (
                  <div
                    key={event.id}
                    title={event.eventName}
                    className={`text-[11px] leading-tight px-1.5 py-1 rounded-lg truncate ${
                      event.myIntent
                        ? myIntentClass(event.myIntent)
                        : 'bg-brand-navy/5 text-brand-navy'
                    }`}
                  >
                    {event.eventName}
                  </div>
                ))}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
