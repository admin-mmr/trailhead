'use client'

import Link from 'next/link'
import Image from 'next/image'
import { useLang } from '@/lib/i18n/context'
import { bi, say, type Bi } from './copy'

/**
 * "Explore 岚山" — photographs as navigation, borrowed from Option J.
 *
 * J's core idea was that pictures of actual members do the wayfinding instead
 * of a row of text links. Every tile points at a PUBLIC route: a visitor who
 * has not joined yet should never hit a login wall from the marketing page.
 *
 * Where we don't yet have a real member photograph, the tile renders an honest
 * placeholder (J's own convention) rather than reusing the flag a third time —
 * swapping in a real photo later is a one-line change to `image`.
 */
interface Tile {
  href: string
  label: Bi
  image: string | null
  /** What belongs here once we have the shot. Shown in the placeholder. */
  wanted?: string
}

const TILES: Tile[] = [
  {
    href: '/join',
    label: bi('Join the club', '加入跑团'),
    image: '/images/mmr-banner.jpg',
  },
  {
    href: '/hall-of-fame',
    label: bi('Hall of Fame', '荣誉殿堂'),
    image: null,
    wanted: 'podium / award shot',
  },
  {
    href: '/faq',
    label: bi('New here?', '新朋友'),
    image: '/images/mmr-flag.jpg',
  },
  {
    href: '/donate',
    label: bi('Support the club', '支持跑团'),
    image: null,
    wanted: 'volunteer table',
  },
]

export default function HomeExplore() {
  const { lang } = useLang()

  return (
    <section className="bg-lantern-blush px-4 py-20 sm:px-6 lg:px-8 lg:py-24">
      <div className="mx-auto max-w-6xl">
        <div className="mb-10 flex items-baseline gap-3">
          <h2 className="font-lantern text-3xl font-bold tracking-tight text-lantern-ink sm:text-4xl">
            Explore <span className="font-zh font-black text-brand-crimson">岚山</span>
          </h2>
          <span className="font-zh text-sm text-lantern-ink-soft" aria-hidden="true">
            探索岚山
          </span>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          {TILES.map(tile => (
            <Link
              key={tile.href}
              href={tile.href}
              className="group relative aspect-[16/10] overflow-hidden rounded-[22px] border border-lantern-line"

            >
              {tile.image ? (
                <Image
                  src={tile.image}
                  alt=""
                  fill
                  sizes="(max-width: 640px) 100vw, 50vw"
                  className="object-cover transition-transform duration-500 group-hover:scale-105"
                />
              ) : (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-gradient-to-br from-lantern-blush-2 to-lantern-gold-tint pb-16 text-center">
                  <span className="font-lantern text-xs font-semibold tracking-wide text-lantern-gold">
                    {say(lang, bi('Member photograph', '会员照片'))}
                  </span>
                  {tile.wanted && (
                    <em className="text-[0.65rem] not-italic text-lantern-ink-soft">{tile.wanted}</em>
                  )}
                </div>
              )}

              <div
                aria-hidden="true"
                className="absolute inset-0 bg-gradient-to-t from-lantern-deep/80 via-lantern-deep/10 to-transparent"
              />

              <div className="absolute inset-x-0 bottom-0 flex flex-wrap items-baseline gap-x-2 gap-y-0.5 p-5">
                <b className="font-lantern text-base font-bold text-white drop-shadow">
                  {lang === 'zh' ? tile.label.zh : tile.label.en}
                </b>
                <span className="font-zh text-xs text-white/70" aria-hidden="true">
                  {lang === 'zh' ? tile.label.en : tile.label.zh}
                </span>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </section>
  )
}
