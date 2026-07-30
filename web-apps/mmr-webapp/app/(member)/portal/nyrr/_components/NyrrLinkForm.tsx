'use client'

import { useState } from 'react'
import { Search, Loader2, Link2 } from 'lucide-react'
import { useLang } from '@/lib/i18n/context'
import { formatLongDate } from '@/lib/date'
import type { MemberResult } from '@/lib/db/nyrr-results'

/**
 * Self-service NYRR result linking: collect the two fields the matcher needs,
 * then have the member confirm which candidate rows are actually theirs.
 *
 * Nothing is linked without an explicit tick. A wrong link poisons
 * NYRRRunnerName, which then makes the admin's Tier-1 matcher confidently
 * recreate the bad match — so the copy warns about it and the server re-checks
 * every id against the candidate criteria anyway.
 */
export default function NyrrLinkForm({
  initialName,
  initialYear,
  onLinked,
}: {
  initialName: string | null
  initialYear: number | null
  onLinked: () => void
}) {
  const { lang, T } = useLang()
  const locale = lang === 'zh' ? 'zh-CN' : 'en-US'

  const [name, setName] = useState(initialName ?? '')
  const [year, setYear] = useState(initialYear != null ? String(initialYear) : '')
  const [candidates, setCandidates] = useState<MemberResult[] | null>(null)
  const [picked, setPicked] = useState<Set<number>>(new Set())
  const [busy, setBusy] = useState<'search' | 'confirm' | null>(null)
  const [error, setError] = useState<string | null>(null)

  const yearNum = Number(year)
  const canSearch = name.trim().length >= 2 && Number.isInteger(yearNum) && yearNum >= 1900

  async function search(e: React.FormEvent) {
    e.preventDefault()
    if (!canSearch) { setError(T('link.invalid')); return }
    setBusy('search')
    setError(null)
    try {
      const res = await fetch('/api/members/me/nyrr-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nyrrRunnerName: name.trim(), yearBorn: yearNum }),
      })
      const json = await res.json()
      if (!res.ok || !json?.ok) throw new Error(json?.error ?? `HTTP ${res.status}`)
      setCandidates(json.data.candidates as MemberResult[])
      setPicked(new Set())
    } catch (err) {
      console.error('[nyrr-link] search failed:', err)
      setError(T('link.failed'))
    } finally {
      setBusy(null)
    }
  }

  async function confirm() {
    if (!picked.size) return
    setBusy('confirm')
    setError(null)
    try {
      const res = await fetch('/api/members/me/nyrr-link/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ runnerIds: Array.from(picked) }),
      })
      const json = await res.json()
      if (!res.ok || !json?.ok) throw new Error(json?.error ?? `HTTP ${res.status}`)
      onLinked()
    } catch (err) {
      console.error('[nyrr-link] confirm failed:', err)
      setError(T('link.confirmFailed'))
    } finally {
      setBusy(null)
    }
  }

  const toggle = (id: number) =>
    setPicked(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  return (
    <div className="space-y-6">
      <form onSubmit={search} className="card p-6 max-w-lg space-y-4">
        <div>
          <h2 className="font-bold text-gray-900">{T('link.heading')}</h2>
          <p className="text-sm text-gray-500 mt-1">{T('link.intro')}</p>
        </div>

        <div>
          <label htmlFor="nyrr-name" className="block text-sm font-medium text-gray-700 mb-1.5">
            {T('link.nameLabel')}
          </label>
          <input
            id="nyrr-name"
            type="text"
            className="input-field"
            value={name}
            maxLength={100}
            onChange={e => setName(e.target.value)}
            placeholder="John Smith"
          />
          <p className="text-xs text-gray-400 mt-1">{T('link.nameHint')}</p>
        </div>

        <div>
          <label htmlFor="nyrr-year" className="block text-sm font-medium text-gray-700 mb-1.5">
            {T('link.yearLabel')}
          </label>
          <input
            id="nyrr-year"
            type="number"
            className="input-field"
            value={year}
            onChange={e => setYear(e.target.value)}
            placeholder="1990"
          />
          <p className="text-xs text-gray-400 mt-1">{T('link.yearHint')}</p>
        </div>

        <button type="submit" disabled={busy !== null} className="btn-primary flex items-center gap-2">
          {busy === 'search'
            ? <Loader2 className="h-4 w-4 animate-spin" />
            : <Search className="h-4 w-4" />}
          {busy === 'search' ? T('link.searching') : T('link.search')}
        </button>

        {error && <p className="text-sm text-red-600">{error}</p>}
      </form>

      {candidates?.length === 0 && (
        <div className="card p-6 max-w-lg">
          <p className="font-medium text-gray-900">{T('link.noneFound')}</p>
          <p className="text-sm text-gray-500 mt-1">{T('link.noneHint')}</p>
        </div>
      )}

      {candidates && candidates.length > 0 && (
        <div className="card p-6">
          <h3 className="font-bold text-gray-900">{T('link.candidates')}</h3>
          <p className="text-sm text-gray-500 mt-1 mb-2">{T('link.candidatesHint')}</p>

          <div className="flex gap-3 mb-3 text-xs">
            <button type="button" onClick={() => setPicked(new Set(candidates.map(c => c.id)))}
                    className="text-brand-navy hover:underline">
              {T('link.selectAll')}
            </button>
            <button type="button" onClick={() => setPicked(new Set())}
                    className="text-gray-500 hover:underline">
              {T('link.clearAll')}
            </button>
          </div>

          <ul className="space-y-2 max-h-96 overflow-y-auto">
            {candidates.map(c => (
              <li key={c.id}>
                <label className="flex items-start gap-3 p-3 rounded-xl border border-gray-100 hover:border-brand-navy/30 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={picked.has(c.id)}
                    onChange={() => toggle(c.id)}
                    className="mt-0.5 h-4 w-4 rounded border-gray-300 text-brand-navy focus:ring-brand-navy"
                  />
                  <span className="min-w-0">
                    <span className="block text-sm font-medium text-gray-900">{c.eventName}</span>
                    <span className="block text-xs text-gray-500 mt-0.5">
                      {formatLongDate(c.eventDate, locale)}
                      {c.distance && ` · ${c.distance}`}
                      {c.finishTime && ` · ${c.finishTime}`}
                      {c.age != null && c.age > 0 && ` · ${T('link.age')} ${c.age}`}
                      {c.bibNumber && ` · #${c.bibNumber}`}
                    </span>
                  </span>
                </label>
              </li>
            ))}
          </ul>

          <button
            type="button"
            onClick={confirm}
            disabled={busy !== null || picked.size === 0}
            className="btn-primary flex items-center gap-2 mt-4 disabled:opacity-50"
          >
            {busy === 'confirm'
              ? <Loader2 className="h-4 w-4 animate-spin" />
              : <Link2 className="h-4 w-4" />}
            {busy === 'confirm' ? T('link.confirming') : `${T('link.confirm')} (${picked.size})`}
          </button>
        </div>
      )}
    </div>
  )
}
