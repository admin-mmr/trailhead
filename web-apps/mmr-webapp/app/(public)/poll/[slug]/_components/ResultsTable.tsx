'use client'

import type { PollResults } from '@/lib/db/polls'

interface Props {
  results: PollResults
  lang: 'en' | 'zh'
  mode: 'single' | 'top3'
}

/**
 * Standings, sorted by points. Bars are scaled to the leader rather than to the
 * ballot count, so a poll with few votes still reads clearly.
 */
export default function ResultsTable({ results, lang, mode }: Props) {
  const t = (en: string, zh: string) => (lang === 'zh' ? zh : en)
  const rows = [...results.rows].sort((a, b) => b.points - a.points || b.firsts - a.firsts)
  const top = rows[0]?.points ?? 0

  return (
    <div>
      <p className="text-sm text-gray-500">
        {results.totalBallots === 1
          ? t('1 ballot so far.', '目前 1 票。')
          : t(`${results.totalBallots} ballots so far.`, `目前 ${results.totalBallots} 票。`)}
        {mode === 'top3' && ' ' + t('First choice scores 3 points, second 2, third 1.',
                                    '第一选择 3 分，第二选择 2 分，第三选择 1 分。')}
      </p>

      <ol className="mt-5 space-y-3">
        {rows.map((r, i) => {
          const label = lang === 'zh' && r.labelZh ? r.labelZh : r.labelEn
          const pct = top > 0 ? Math.round((r.points / top) * 100) : 0
          return (
            <li key={r.code} className="rounded-xl border border-gray-200 bg-white p-4">
              <div className="flex items-baseline justify-between gap-4">
                <span className="font-semibold text-gray-900">
                  <span className="text-gray-400 tabular-nums mr-2">{i + 1}.</span>{label}
                </span>
                <span className="text-sm font-bold tabular-nums" style={{ color: '#C8102E' }}>
                  {r.points} {t('pts', '分')}
                </span>
              </div>

              <div className="mt-2.5 h-2 w-full overflow-hidden rounded-full bg-gray-100">
                <div
                  className="h-full rounded-full transition-all"
                  style={{ width: `${pct}%`, background: 'linear-gradient(90deg,#8C0E20,#C8102E)' }}
                />
              </div>

              {mode === 'top3' && (
                <p className="mt-2 text-xs text-gray-500 tabular-nums">
                  {t('1st', '第一')} {r.firsts} · {t('2nd', '第二')} {r.seconds} · {t('3rd', '第三')} {r.thirds}
                </p>
              )}
            </li>
          )
        })}
      </ol>

      {results.comments.length > 0 && (
        <div className="mt-10">
          <h3 className="font-semibold text-gray-900">
            {t('What people said', '大家的留言')}
            <span className="ml-2 text-sm font-normal text-gray-400">
              {t('shown without names', '匿名显示')}
            </span>
          </h3>
          <ul className="mt-4 space-y-3">
            {results.comments.map((c, i) => (
              <li key={i} className="rounded-xl border border-gray-200 bg-white p-4 text-sm text-gray-700
                                     leading-relaxed whitespace-pre-wrap">
                {c}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
