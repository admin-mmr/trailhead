'use client'

import { useLang } from '@/lib/i18n/context'
import { pair } from '@/lib/i18n/translations'

/**
 * A nav item in the reader's chosen language.
 *
 * This briefly showed BOTH languages at once ("Home 首页"), copying peer club
 * newbeerunning.org. In review that read as clutter rather than inclusion —
 * picking English should give you English. The language toggle is the single
 * source of truth for every nav label; the only thing that stays bilingual is
 * the club's own name in the wordmark, which is a name rather than copy.
 */
export default function NavLabel({ keyEn }: { keyEn: Parameters<typeof pair>[0] }) {
  const { lang } = useLang()
  const { en, zh } = pair(keyEn)
  return <span className="whitespace-nowrap">{lang === 'zh' ? zh : en}</span>
}
