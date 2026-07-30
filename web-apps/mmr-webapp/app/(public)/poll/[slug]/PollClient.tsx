'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useLang } from '@/lib/i18n/context'
import type { Poll, PollResults } from '@/lib/db/polls'
import { MAX_COMMENT_LEN, RANKS_FOR_MODE, RANK_LABELS } from '@/lib/poll-shared'
import PollCard from './_components/PollCard'
import VoterFields from './_components/VoterFields'
import ResultsTable from './_components/ResultsTable'

export default function PollClient({ poll }: { poll: Poll }) {
  const { lang } = useLang()
  const t = (en: string, zh: string) => (lang === 'zh' ? zh : en)

  const needed = RANKS_FOR_MODE[poll.mode]
  const [picks, setPicks] = useState<string[]>([])       // option codes, in rank order
  const [memberId, setMemberId] = useState('')
  const [lastName, setLastName] = useState('')
  const [comment, setComment] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [results, setResults] = useState<PollResults | null>(null)

  const rankOf = useMemo(() => {
    const m = new Map<string, number>()
    picks.forEach((code, i) => m.set(code, i + 1))
    return m
  }, [picks])

  const toggle = (code: string) => {
    setError(null)
    setPicks(prev => prev.includes(code)
      ? prev.filter(c => c !== code)          // clearing re-numbers the rest
      : prev.length >= needed ? prev : [...prev, code])
  }

  const ready = picks.length === needed && memberId.trim() && lastName.trim() && !busy

  async function submit() {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/poll/${poll.slug}/vote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ memberId, lastName, choices: picks, comment: comment || undefined }),
      })
      // A gated route can 307 to /login at the edge, in which case res.ok is
      // true but the body is HTML — so never assume this parses.
      let data: { ok?: boolean; error?: string; results?: PollResults } = {}
      try {
        data = await res.json()
      } catch {
        throw new Error(t('Something went wrong. Please try again.', '出错了，请重试。'))
      }
      if (!res.ok || !data.ok) {
        throw new Error(data.error || t('Something went wrong. Please try again.', '出错了，请重试。'))
      }
      setResults(data.results ?? null)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('Something went wrong.', '出错了。'))
    } finally {
      setBusy(false)
    }
  }

  // ── after voting ─────────────────────────────────────────────────────────
  if (results) {
    return (
      <div className="mx-auto max-w-3xl px-4 sm:px-6 py-14">
        <div className="rounded-2xl border p-6 mb-10"
             style={{ background: '#F0FDF4', borderColor: '#BBF7D0' }}>
          <h1 className="section-title mb-1" style={{ fontSize: '1.6rem' }}>
            {t('Thank you — your vote is in.', '感谢您的投票！')}
          </h1>
          <p className="text-sm text-gray-600">
            {t('You can come back and change your vote any time while the poll is open.',
               '投票期间，您可以随时回来修改您的选择。')}
          </p>
        </div>
        <h2 className="section-title" style={{ fontSize: '1.4rem' }}>{t('Results so far', '目前结果')}</h2>
        <ResultsTable results={results} lang={lang} mode={poll.mode} />
        <div className="mt-10 flex flex-wrap gap-3">
          <Link href={`/poll/${poll.slug}/results`} className="btn-secondary">
            {t('Open the results page', '打开结果页面')}
          </Link>
          <button type="button" className="btn-ghost" onClick={() => setResults(null)}>
            {t('Change my vote', '修改我的投票')}
          </button>
        </div>
      </div>
    )
  }

  // ── voting ───────────────────────────────────────────────────────────────
  const title = lang === 'zh' && poll.titleZh ? poll.titleZh : poll.titleEn
  const desc = lang === 'zh' && poll.descriptionZh ? poll.descriptionZh : poll.descriptionEn

  return (
    <div className="mx-auto max-w-6xl px-4 sm:px-6 py-12">
      <header className="max-w-3xl">
        <h1 className="section-title mb-3">{title}</h1>
        {desc && <p className="text-gray-600 leading-relaxed">{desc}</p>}
      </header>

      {poll.status === 'closed' && (
        <div className="mt-8 rounded-xl border p-4 text-sm"
             style={{ background: '#FFFBEB', borderColor: '#FDE68A', color: '#92400E' }}>
          {t('This poll has closed. You can still see the results.', '投票已结束，但您仍可查看结果。')}
          {' '}
          <Link href={`/poll/${poll.slug}/results`} className="font-semibold underline">
            {t('View results →', '查看结果 →')}
          </Link>
        </div>
      )}

      {/* running tally of picks, so the ask is never ambiguous */}
      <div className="sticky top-16 z-30 -mx-4 sm:-mx-6 mt-8 mb-6 border-y bg-white/95 px-4 sm:px-6 py-3 backdrop-blur"
           style={{ borderColor: 'rgba(212,168,67,0.35)' }}>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <span className="text-sm font-semibold text-gray-900">
            {poll.mode === 'top3'
              ? t('Pick your top three, in order', '请按顺序选出前三名')
              : t('Pick one', '请选择一个')}
          </span>
          {Array.from({ length: needed }, (_, i) => {
            const code = picks[i]
            const opt = poll.options.find(o => o.code === code)
            const label = opt ? (lang === 'zh' && opt.labelZh ? opt.labelZh : opt.labelEn) : null
            return (
              <span key={i}
                    className="rounded-full border px-3 py-1 text-xs font-medium"
                    style={label
                      ? { background: 'rgba(200,16,46,0.08)', borderColor: 'rgba(200,16,46,0.35)', color: '#8C0E20' }
                      : { background: '#fff', borderColor: '#E5E7EB', color: '#9CA3AF' }}>
                {RANK_LABELS[i]?.[lang]}{label ? `: ${label}` : ''}
              </span>
            )
          })}
        </div>
      </div>

      <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
        {poll.options.map(o => (
          <PollCard
            key={o.code}
            option={o}
            lang={lang}
            rank={rankOf.get(o.code) ?? null}
            onToggle={() => toggle(o.code)}
            disabled={poll.status !== 'open' || picks.length >= needed}
          />
        ))}
      </div>

      {poll.status === 'open' && (
        <div className="mt-10 max-w-2xl">
          <VoterFields
            lang={lang}
            memberId={memberId} lastName={lastName} comment={comment}
            onMemberId={setMemberId} onLastName={setLastName} onComment={setComment}
            maxComment={MAX_COMMENT_LEN}
          />

          {error && (
            <div role="alert" className="mt-4 rounded-xl border p-4 text-sm"
                 style={{ background: '#FEF2F2', borderColor: '#FECACA', color: '#991B1B' }}>
              {error}
            </div>
          )}

          <div className="mt-6 flex flex-wrap items-center gap-4">
            <button type="button" className="btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
                    disabled={!ready} onClick={submit}>
              {busy ? t('Submitting…', '正在提交…') : t('Submit my vote', '提交投票')}
            </button>
            {picks.length !== needed && (
              <span className="text-sm text-gray-500">
                {t(`Choose ${needed - picks.length} more.`, `还需选择 ${needed - picks.length} 个。`)}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
