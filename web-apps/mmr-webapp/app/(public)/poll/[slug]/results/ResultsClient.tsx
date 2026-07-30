'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useLang } from '@/lib/i18n/context'
import type { PollResults } from '@/lib/db/polls'
import ResultsTable from '../_components/ResultsTable'

interface Props {
  slug: string
  titleEn: string
  titleZh: string | null
  mode: 'single' | 'top3'
}

export default function ResultsClient({ slug, titleEn, titleZh, mode }: Props) {
  const { lang } = useLang()
  const t = (en: string, zh: string) => (lang === 'zh' ? zh : en)

  const [state, setState] = useState<'loading' | 'ok' | 'locked' | 'error'>('loading')
  const [results, setResults] = useState<PollResults | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch(`/api/poll/${slug}/results`)
        // res.ok can be true with an HTML body if the edge redirected us, so
        // json() is always guarded.
        let data: { ok?: boolean; error?: string; locked?: boolean; results?: PollResults } = {}
        try {
          data = await res.json()
        } catch {
          if (!cancelled) { setState('error'); setMessage(t('Could not load results.', '无法加载结果。')) }
          return
        }
        if (cancelled) return
        if (res.status === 403 && data.locked) {
          setState('locked')
          setMessage(data.error ?? null)
          return
        }
        if (!res.ok || !data.ok || !data.results) {
          setState('error')
          setMessage(data.error ?? t('Could not load results.', '无法加载结果。'))
          return
        }
        setResults(data.results)
        setState('ok')
      } catch {
        if (!cancelled) { setState('error'); setMessage(t('Could not load results.', '无法加载结果。')) }
      }
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug])

  const title = lang === 'zh' && titleZh ? titleZh : titleEn

  return (
    <div className="mx-auto max-w-3xl px-4 sm:px-6 py-14">
      <h1 className="section-title mb-2">{t('Results', '投票结果')}</h1>
      <p className="text-gray-500 mb-8">{title}</p>

      {state === 'loading' && (
        <p className="text-gray-500">{t('Loading…', '加载中…')}</p>
      )}

      {state === 'locked' && (
        <div className="rounded-2xl border p-6"
             style={{ background: '#FFFBEB', borderColor: '#FDE68A' }}>
          <h2 className="font-semibold text-gray-900 mb-1">
            {t('Vote first to see the results', '投票后即可查看结果')}
          </h2>
          <p className="text-sm text-gray-600 mb-4">
            {message ?? t('Results open up once you have cast your ballot.', '投票后即可查看结果。')}
          </p>
          <Link href={`/poll/${slug}`} className="btn-primary">
            {t('Go and vote', '去投票')}
          </Link>
        </div>
      )}

      {state === 'error' && (
        <div role="alert" className="rounded-2xl border p-6"
             style={{ background: '#FEF2F2', borderColor: '#FECACA', color: '#991B1B' }}>
          {message}
        </div>
      )}

      {state === 'ok' && results && (
        <>
          <ResultsTable results={results} lang={lang} mode={mode} />
          <div className="mt-10">
            <Link href={`/poll/${slug}`} className="btn-ghost">
              {t('← Back to the designs', '← 返回设计方案')}
            </Link>
          </div>
        </>
      )}
    </div>
  )
}
