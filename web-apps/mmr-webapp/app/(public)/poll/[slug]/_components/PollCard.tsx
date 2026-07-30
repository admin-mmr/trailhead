'use client'

import Image from 'next/image'
import { clsx } from 'clsx'
import type { PollOption } from '@/lib/db/polls'
import { RANK_LABELS } from '@/lib/poll-shared'
import { safeLinkOrNull } from '@/lib/safe-url'

interface Props {
  option: PollOption
  lang: 'en' | 'zh'
  /** 1-based rank if this option is picked, otherwise null. */
  rank: number | null
  onToggle: () => void
  disabled: boolean
}

/**
 * One design in the poll grid.
 *
 * The card image is only the top of a long page, so every option also links to
 * its full, scrollable mockup. That link is a sibling of the select button, not
 * a child: an <a> nested inside a <button> is invalid HTML and browsers handle
 * the click ambiguously.
 */
export default function PollCard({ option, lang, rank, onToggle, disabled }: Props) {
  const label = lang === 'zh' && option.labelZh ? option.labelZh : option.labelEn
  const tagline = lang === 'zh' && option.taglineZh ? option.taglineZh : option.taglineEn
  const picked = rank != null
  const rankLabel = rank != null ? RANK_LABELS[rank - 1]?.[lang] : null
  // detail_path comes from the database, so it is never trusted as an href
  const detail = safeLinkOrNull(option.detailPath)
  const t = (en: string, zh: string) => (lang === 'zh' ? zh : en)

  return (
    <div
      className={clsx(
        'group relative rounded-2xl border-2 bg-white overflow-hidden transition-all',
        picked ? 'border-brand-crimson shadow-lg' : 'border-gray-200 hover:border-brand-gold hover:shadow-md',
        disabled && !picked && 'opacity-45'
      )}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-pressed={picked}
        // Not disabled when picked — a picked card must stay clickable to clear it.
        disabled={disabled && !picked}
        className={clsx(
          'block w-full text-left focus:outline-none focus-visible:ring-4 focus-visible:ring-brand-crimson/30',
          disabled && !picked && 'cursor-not-allowed'
        )}
      >
        <div className="relative aspect-[16/10] bg-gray-100">
          {option.imagePath && (
            <Image
              src={option.imagePath}
              alt={`${option.labelEn} — top of the page`}
              fill
              className="object-cover object-top"
              sizes="(max-width: 768px) 100vw, (max-width: 1280px) 50vw, 33vw"
            />
          )}
          {picked && (
            <span className="absolute top-3 left-3 flex items-center gap-2 rounded-full bg-brand-crimson px-3 py-1.5
                             text-white text-xs font-bold shadow-md">
              <span className="grid h-5 w-5 place-items-center rounded-full bg-white/25 text-[0.7rem]">{rank}</span>
              {rankLabel}
            </span>
          )}
          {/* the image is a crop, so say so rather than letting people assume */}
          <span className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/55 to-transparent
                           px-3 pt-6 pb-2 text-[0.68rem] font-medium text-white/90">
            {t('Top of the page only — open the full design to scroll it',
               '仅显示页面顶部 — 打开完整设计可滚动查看')}
          </span>
        </div>

        <div className="p-4 pb-3">
          <h3 className="font-semibold text-gray-900">{label}</h3>
          {tagline && <p className="mt-1 text-sm text-gray-500 leading-relaxed">{tagline}</p>}
        </div>
      </button>

      {detail && (
        <div className="px-4 pb-4 -mt-1">
          <a
            href={detail}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-semibold
                       transition-colors focus:outline-none focus-visible:ring-4 focus-visible:ring-brand-crimson/30"
            style={{ borderColor: 'rgba(212,168,67,0.55)', color: '#8A6A1E' }}
          >
            {t('See the full design', '查看完整设计')}
            <span aria-hidden="true">↗</span>
            <span className="sr-only">{t('(opens in a new tab)', '（在新标签页打开）')}</span>
          </a>
        </div>
      )}
    </div>
  )
}
