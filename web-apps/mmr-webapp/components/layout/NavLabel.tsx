'use client'

import { clsx } from 'clsx'
import { useLang } from '@/lib/i18n/context'
import { pair } from '@/lib/i18n/translations'

/**
 * A nav item in BOTH languages at once — "Home 主页".
 *
 * Peer club newbeerunning.org does this rather than hiding one language behind
 * a toggle, so nobody has to find a control before they can read the menu.
 * The language toggle still governs body copy; the nav no longer depends on it.
 * Chinese sits on the baseline beside the English at a smaller size, so the row
 * height is unchanged.
 */
export default function NavLabel({ keyEn, active }: { keyEn: Parameters<typeof pair>[0]; active?: boolean }) {
  const { lang } = useLang()
  const { en, zh } = pair(keyEn)
  // Both languages always show; the reader's own leads at full size. Marking
  // the secondary aria-hidden stops a screen reader announcing every item twice.
  const [primary, secondary] = lang === 'zh' ? [zh, en] : [en, zh]
  return (
    <span className="flex items-baseline gap-1.5 whitespace-nowrap">
      <span className={lang === 'zh' ? 'font-zh' : undefined}>{primary}</span>
      <span
        className={clsx(
          'text-[0.68rem] font-normal',
          lang === 'zh' ? undefined : 'font-zh',
          active ? 'text-brand-gold/75' : 'text-white/45',
        )}
        aria-hidden="true"
      >
        {secondary}
      </span>
    </span>
  )
}
