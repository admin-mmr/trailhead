'use client'

import { useLang } from '@/lib/i18n/context'
import { bi, say } from './copy'

/**
 * Stat strip, lifted into the seam between hero and content (Option C).
 *
 * Member and race counts are read live; the two constants below are facts about
 * the club rather than table counts. A failed stats read passes null and the
 * card falls back to the rounded figure rather than rendering "0 members".
 */
export default function HomeStats({
  activeMembers,
  racesThisYear,
}: {
  activeMembers: number | null
  racesThisYear: number | null
}) {
  const { lang } = useLang()

  const cards = [
    {
      n: activeMembers !== null && activeMembers > 0 ? `${activeMembers}` : '400+',
      label: bi('Active members', '活跃会员'),
    },
    {
      n: racesThisYear !== null && racesThisYear > 0 ? `${racesThisYear}` : '150+',
      label: bi(`Races in ${new Date().getFullYear()}`, `${new Date().getFullYear()} 年比赛`),
    },
    { n: '11', label: bi('Years running', '成立年数') },
    { n: '501(c)(3)', label: bi('Nonprofit club', '非营利跑团') },
  ]

  return (
    // relative + z-10: the strip is pulled up into the hero with a negative
    // margin, and without its own stacking position the hero paints over it.
    <section className="relative z-10 px-4 sm:px-6 lg:px-8">
      <div className="mx-auto -mt-12 grid max-w-6xl grid-cols-2 gap-4 lg:grid-cols-4">
        {cards.map(card => (
          <div
            key={card.label.en}
            className="rounded-[22px] border border-lantern-line bg-white px-5 py-6 text-center shadow-[0_18px_40px_-16px_rgba(140,14,32,0.16)]"
          >
            <div className="font-lantern text-3xl font-extrabold tracking-tight text-brand-crimson sm:text-4xl">
              {card.n}
            </div>
            <div className="mt-2 text-xs font-medium text-lantern-ink-soft sm:text-sm">
              {say(lang, card.label)}
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}
