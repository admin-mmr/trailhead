'use client'

import { useCallback, useEffect, useState } from 'react'
import { Users, HandHeart, Star } from 'lucide-react'
import { useLang } from '@/lib/i18n/context'
import type { EventRoster } from '@/lib/db/events'

/**
 * Expandable "who's going" list for one event.
 *
 * Members who opted out of the roster are counted but not named — the server
 * enforces that; here we just surface `hiddenCount` so the numbers visibly add
 * up without hinting at who opted out.
 */
export default function RosterPanel({ eventId }: { eventId: number }) {
  const { T } = useLang()
  const [roster, setRoster] = useState<EventRoster | null>(null)
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true)
    setFailed(false)
    try {
      const res = await fetch(`/api/events/${eventId}/roster`, { signal })
      const json = await res.json()
      if (!res.ok || !json?.ok) throw new Error(json?.error ?? `HTTP ${res.status}`)
      setRoster(json.data as EventRoster)
    } catch (err) {
      if ((err as Error)?.name === 'AbortError') return
      console.error('[roster] load failed:', err)
      setFailed(true)
    } finally {
      setLoading(false)
    }
  }, [eventId])

  useEffect(() => {
    const ctrl = new AbortController()
    load(ctrl.signal)
    return () => ctrl.abort()
  }, [load])

  if (loading) return <p className="text-xs text-gray-400 py-2">{T('common.loading')}</p>
  if (failed) return <p className="text-xs text-red-600 py-2">{T('rsvp.rosterFailed')}</p>
  if (!roster) return null

  const groups = [
    { key: 'running' as const, icon: Users, label: T('cal.running') },
    { key: 'volunteering' as const, icon: HandHeart, label: T('cal.volunteering') },
    { key: 'interested' as const, icon: Star, label: T('cal.interested') },
  ].filter(g => roster[g.key].length > 0)

  const nobodyListed = groups.length === 0
  const nobodyAtAll =
    nobodyListed &&
    roster.hiddenCount === 0 &&
    roster.counts.running === 0 &&
    roster.counts.volunteering === 0 &&
    roster.counts.interested === 0

  return (
    <div className="mt-3 pt-3 border-t border-gray-100 space-y-3">
      {nobodyAtAll && <p className="text-xs text-gray-400">{T('rsvp.nobodyYet')}</p>}

      {groups.map(({ key, icon: Icon, label }) => (
        <div key={key}>
          <p className="inline-flex items-center gap-1.5 text-xs font-semibold text-gray-500 mb-1.5">
            <Icon className="w-3.5 h-3.5" aria-hidden="true" />
            {label} ({roster.counts[key]})
          </p>
          <ul className="flex flex-wrap gap-1.5">
            {roster[key].map(entry => (
              <li
                key={entry.memberId}
                title={entry.note ?? undefined}
                className="text-xs bg-gray-50 text-gray-700 px-2 py-1 rounded-lg"
              >
                {entry.name}
                {entry.note && <span className="text-gray-400"> · {entry.note}</span>}
              </li>
            ))}
          </ul>
        </div>
      ))}

      {roster.hiddenCount > 0 && (
        <p className="text-xs text-gray-400">
          {roster.hiddenCount === 1
            ? T('rsvp.hiddenOne')
            : `${roster.hiddenCount} ${T('rsvp.hiddenMany')}`}
        </p>
      )}
    </div>
  )
}
