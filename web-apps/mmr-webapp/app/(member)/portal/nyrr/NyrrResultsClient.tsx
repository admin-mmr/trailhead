'use client'

import { useCallback, useEffect, useState } from 'react'
import { AlertCircle } from 'lucide-react'
import { useLang } from '@/lib/i18n/context'
import type { MemberResult } from '@/lib/db/nyrr-results'
import type { NyrrResult } from '@/types'
import NyrrClient from './NyrrClient'
import NyrrLinkForm from './_components/NyrrLinkForm'

interface Payload {
  results: MemberResult[]
  linked: boolean
  profile: { nyrrRunnerName: string | null; yearBorn: number | null }
}

/**
 * Adapt the API row to the shape the existing chart dashboard expects.
 * NyrrClient predates this feature and was previously imported nowhere; it's a
 * working recharts dashboard, so it's reused rather than rewritten.
 */
function toNyrrResult(r: MemberResult): NyrrResult {
  return {
    id: r.id,
    memberId: '',
    nyrrEventCode: String(r.eventId),
    eventName: r.eventName,
    eventDate: r.eventDate,
    finishTime: r.finishTime ?? undefined,
    pace: r.pace ?? undefined,
    overallPlace: r.overallPlace ?? undefined,
    genderPlace: r.genderPlace ?? undefined,
    distance: r.distance ?? undefined,
  }
}

export default function NyrrResultsClient() {
  const { T } = useLang()
  const [payload, setPayload] = useState<Payload | null>(null)
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true)
    setFailed(false)
    try {
      const res = await fetch('/api/members/me/nyrr-results', { signal })
      // A gated route 307s to /login at the edge, so res.ok can be true while
      // the body is HTML — json() throws and we land in catch.
      const json = await res.json()
      if (!res.ok || !json?.ok) throw new Error(json?.error ?? `HTTP ${res.status}`)
      setPayload(json.data as Payload)
    } catch (err) {
      if ((err as Error)?.name === 'AbortError') return
      console.error('[nyrr-results] load failed:', err)
      setFailed(true)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    const ctrl = new AbortController()
    load(ctrl.signal)
    return () => ctrl.abort()
  }, [load])

  if (loading) {
    return <p className="text-sm text-gray-500 py-12 text-center">{T('common.loading')}</p>
  }

  if (failed) {
    return (
      <div className="card p-6 text-center max-w-md mx-auto">
        <AlertCircle className="w-6 h-6 text-red-500 mx-auto mb-2" aria-hidden="true" />
        <p className="text-sm text-red-800 mb-3">{T('common.error')}</p>
        <button type="button" onClick={() => load()} className="text-sm font-medium text-brand-navy hover:underline">
          {T('cal.retry')}
        </button>
      </div>
    )
  }

  // No linked results yet → collect the two matcher fields and confirm candidates.
  if (!payload?.linked) {
    return (
      <NyrrLinkForm
        initialName={payload?.profile.nyrrRunnerName ?? null}
        initialYear={payload?.profile.yearBorn ?? null}
        onLinked={() => load()}
      />
    )
  }

  return <NyrrClient results={payload.results.map(toNyrrResult)} />
}
