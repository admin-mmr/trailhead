'use client'

import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import { useLang } from '@/lib/i18n/context'
import type { RsvpIntent } from '@/lib/db/events'

const OPTIONS: { intent: RsvpIntent; key: 'rsvp.imRunning' | 'rsvp.imVolunteering' | 'rsvp.interested' | 'rsvp.notGoing' }[] = [
  { intent: 'running',      key: 'rsvp.imRunning' },
  { intent: 'volunteering', key: 'rsvp.imVolunteering' },
  { intent: 'interested',   key: 'rsvp.interested' },
  { intent: 'not_going',    key: 'rsvp.notGoing' },
]

/**
 * The four RSVP buttons plus an optional note, for one event.
 *
 * Tapping the already-selected intent clears the RSVP (DELETE) — that's the
 * only way back to "no response", and it reads naturally as a toggle. The
 * server-side upsert is idempotent, so a double tap is harmless either way.
 */
export default function RsvpControls({
  eventId,
  intent,
  note,
  isPast,
  onChange,
}: {
  eventId: number
  intent: RsvpIntent | null
  note: string | null
  isPast: boolean
  onChange: (next: { intent: RsvpIntent | null; note: string | null }) => void
}) {
  const { T } = useLang()
  const [saving, setSaving] = useState<RsvpIntent | 'clear' | null>(null)
  const [failed, setFailed] = useState(false)
  const [draftNote, setDraftNote] = useState(note ?? '')

  if (isPast) {
    return <p className="text-xs text-gray-400">{T('rsvp.pastRace')}</p>
  }

  async function submit(next: RsvpIntent | null) {
    setSaving(next ?? 'clear')
    setFailed(false)
    try {
      const res = await fetch(`/api/events/${eventId}/rsvp`, {
        method: next ? 'POST' : 'DELETE',
        headers: next ? { 'Content-Type': 'application/json' } : undefined,
        body: next ? JSON.stringify({ intent: next, note: draftNote.trim() || undefined }) : undefined,
      })
      // A gated route 307s to /login at the edge, so fetch can land on an HTML
      // page with res.ok true — json() then throws and we fall into catch.
      const json = await res.json()
      if (!res.ok || !json?.ok) throw new Error(json?.error ?? `HTTP ${res.status}`)
      onChange({ intent: next, note: next ? (draftNote.trim() || null) : null })
    } catch (err) {
      console.error('[rsvp] save failed:', err)
      setFailed(true)
    } finally {
      setSaving(null)
    }
  }

  return (
    <div>
      <div className="flex flex-wrap gap-2">
        {OPTIONS.map(({ intent: option, key }) => {
          const selected = intent === option
          const busy = saving === option || (selected && saving === 'clear')
          return (
            <button
              key={option}
              type="button"
              aria-pressed={selected}
              disabled={saving !== null}
              onClick={() => submit(selected ? null : option)}
              className={`inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-xl border transition-colors disabled:opacity-50 ${
                selected
                  ? 'bg-brand-navy text-white border-brand-navy'
                  : 'bg-white text-gray-600 border-gray-200 hover:border-brand-navy hover:text-brand-navy'
              }`}
            >
              {busy && <Loader2 className="w-3 h-3 animate-spin" aria-hidden="true" />}
              {T(key)}
            </button>
          )
        })}
      </div>

      {intent && (
        <div className="mt-2">
          <input
            type="text"
            maxLength={280}
            value={draftNote}
            onChange={e => setDraftNote(e.target.value)}
            onBlur={() => {
              if ((note ?? '') !== draftNote.trim()) submit(intent)
            }}
            placeholder={T('rsvp.notePlaceholder')}
            className="w-full text-xs px-3 py-2 rounded-xl border border-gray-200 focus:border-brand-navy focus:outline-none"
          />
        </div>
      )}

      {failed && <p className="text-xs text-red-600 mt-2">{T('rsvp.failed')}</p>}
    </div>
  )
}
