'use client'

import Image from 'next/image'
import { clsx } from 'clsx'
import type { PollOption } from '@/lib/db/polls'
import { RANK_LABELS } from '@/lib/poll-shared'

interface Props {
  option: PollOption
  lang: 'en' | 'zh'
  /** 1-based rank if this option is picked, otherwise null. */
  rank: number | null
  onToggle: () => void
  disabled: boolean
}

/**
 * One design in the poll grid. The rank badge is the only affordance — tapping
 * a picked card clears it, which is why there is no separate remove control.
 */
export default function PollCard({ option, lang, rank, onToggle, disabled }: Props) {
  const label = lang === 'zh' && option.labelZh ? option.labelZh : option.labelEn
  const tagline = lang === 'zh' && option.taglineZh ? option.taglineZh : option.taglineEn
  const picked = rank != null
  const rankLabel = rank != null ? RANK_LABELS[rank - 1]?.[lang] : null

  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={picked}
      // Not disabled when picked — a picked card must stay clickable to clear it.
      disabled={disabled && !picked}
      className={clsx(
        'group relative text-left rounded-2xl border-2 bg-white overflow-hidden transition-all',
        'focus:outline-none focus-visible:ring-4 focus-visible:ring-brand-crimson/30',
        picked
          ? 'border-brand-crimson shadow-lg'
          : 'border-gray-200 hover:border-brand-gold hover:shadow-md',
        disabled && !picked && 'opacity-45 cursor-not-allowed'
      )}
    >
      <div className="relative aspect-[16/10] bg-gray-100">
        {option.imagePath && (
          <Image
            src={option.imagePath}
            alt={`${option.labelEn} — design preview`}
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
      </div>

      <div className="p-4">
        <h3 className="font-semibold text-gray-900">{label}</h3>
        {tagline && <p className="mt-1 text-sm text-gray-500 leading-relaxed">{tagline}</p>}
      </div>
    </button>
  )
}
