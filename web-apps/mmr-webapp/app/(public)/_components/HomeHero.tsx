'use client'

import Link from 'next/link'
import Image from 'next/image'
import { useLang } from '@/lib/i18n/context'
import { bi, say } from './copy'

/**
 * Option C · "Lantern" hero — the design the club voted for.
 *
 * The defining choice: the bilingual lockup is the headline. 岚山跑团 is set
 * large in Noto Sans SC with the English name beneath it, and BOTH are always
 * visible regardless of the language toggle — the club's identity is bilingual,
 * so the masthead shouldn't pick a side.
 */
export default function HomeHero({ activeMembers }: { activeMembers: number | null }) {
  const { lang } = useLang()

  return (
    <section className="relative overflow-hidden bg-gradient-to-b from-lantern-blush to-lantern-blush-2 px-4 pb-24 pt-16 sm:px-6 lg:px-8 lg:pb-28 lg:pt-24">
      {/* The 岚 mark as an oversized watermark — circular-masked and multiplied
          so its red plate melts into the canvas instead of reading as a
          stray pale rectangle. Decorative only. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -right-32 -top-28 hidden h-[600px] w-[600px] rounded-full opacity-[0.16] mix-blend-multiply lg:block"
        style={{
          backgroundImage: "url('/images/mmr-logo.png')",
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          WebkitMaskImage: 'radial-gradient(circle, #000 52%, transparent 74%)',
          maskImage: 'radial-gradient(circle, #000 52%, transparent 74%)',
        }}
      />
      <div aria-hidden="true" className="pointer-events-none absolute -left-32 top-16 h-[420px] w-[420px] rounded-full bg-lantern-gold-foil/20 blur-[80px]" />
      <div aria-hidden="true" className="pointer-events-none absolute -bottom-36 right-44 hidden h-[380px] w-[380px] rounded-full bg-brand-crimson/10 blur-[80px] lg:block" />

      <div className="relative mx-auto grid max-w-6xl items-center gap-12 lg:grid-cols-[1.02fr_0.98fr] lg:gap-16">
        <div>
          <span className="inline-flex items-center gap-2 rounded-full border border-lantern-gold-foil/40 bg-lantern-gold-tint px-4 py-2 text-xs font-semibold tracking-wide text-lantern-gold">
            ◆ {say(lang, bi('Family · Support · Pursuit · Community', '有家 · 有爱 · 一起奔跑'))}
          </span>

          {/*
            The club name in the reader's language only.

            This originally showed 岚山跑团 large with "Misty Mountain Runners"
            beneath it in BOTH modes — the lockup that defined Option C. It was
            pulled back because an English reader should get an English page.
            To restore the bilingual lockup, render both spans again instead of
            branching on `lang`.
          */}
          <h1 className="mt-6">
            {lang === 'zh' ? (
              <span className="block font-zh font-black leading-[1.02] tracking-[0.03em] text-brand-crimson-dark [font-size:clamp(3.25rem,7vw,5.375rem)]">
                岚山跑团
              </span>
            ) : (
              <span className="block font-lantern font-extrabold leading-[1.04] tracking-[-0.03em] text-brand-crimson-dark [font-size:clamp(2.75rem,5.6vw,4.25rem)]">
                Misty Mountain Runners
              </span>
            )}
          </h1>

          <div className="my-7 flex items-center gap-3.5">
            <i aria-hidden="true" className="h-0.5 w-14 flex-none rounded bg-gradient-to-r from-lantern-gold-foil to-transparent" />
            <span className="text-[0.7rem] font-semibold uppercase tracking-[0.16em] text-lantern-ink-soft">
              {say(lang, bi('NYRR Official Club Team · Est. 2015', 'NYRR 官方跑团 · 2015 年创立'))}
            </span>
          </div>

          <p className="max-w-[44ch] text-lg leading-relaxed text-lantern-ink-soft">
            {say(lang, bi(
              'Weekly group runs across all five boroughs, a scoring NYRR race team, and a community that runs — and eats — together.',
              '每周在纽约五个区一起跑步，一支参加 NYRR 积分赛的队伍，一个一起跑步、也一起吃饭的社区。',
            ))}
          </p>

          <div className="mt-8 flex flex-wrap gap-3">
            <Link
              href="/join"
              className="inline-flex items-center gap-2 rounded-full bg-brand-crimson px-7 py-4 text-[0.95rem] font-semibold text-white shadow-lg shadow-brand-crimson/40 transition-colors hover:bg-brand-crimson-dark"
            >
              {say(lang, bi('Join the club', '加入跑团'))} →
            </Link>
            <Link
              href="/login"
              className="inline-flex items-center gap-2 rounded-full border border-lantern-line bg-white px-7 py-4 text-[0.95rem] font-semibold text-lantern-ink transition-colors hover:border-lantern-gold-foil"
            >
              {say(lang, bi('Member login', '会员登录'))}
            </Link>
          </div>
        </div>

        {/* Club flag, framed. Floating cards echo the mockup but carry real
            numbers where we have them. */}
        <div className="relative">
          <div className="overflow-hidden rounded-[30px] border border-lantern-gold-foil/30 shadow-[0_18px_40px_-16px_rgba(140,14,32,0.16)]">
            <Image
              src="/images/mmr-flag.jpg"
              alt={say(lang, bi('The MMR club flag at a race', '岚山跑团的队旗'))}
              width={640}
              height={640}
              priority
              className="aspect-square w-full object-cover"
            />
          </div>

          {activeMembers !== null && (
            <div className="absolute -right-3 top-8 rounded-2xl border border-lantern-line bg-white px-5 py-4 shadow-[0_18px_40px_-16px_rgba(140,14,32,0.16)] lg:-right-6">
              <div className="font-lantern text-sm font-bold text-lantern-ink">
                {activeMembers.toLocaleString()} {say(lang, bi('members strong', '位活跃会员'))}
              </div>
              <div className="mt-1 text-xs text-lantern-ink-soft">
                {say(lang, bi('and counting', '还在增加'))}
              </div>
            </div>
          )}

          <div className="absolute -left-3 bottom-10 rounded-2xl border border-lantern-line bg-white px-5 py-4 shadow-[0_18px_40px_-16px_rgba(140,14,32,0.16)] lg:-left-7">
            <div className="font-lantern text-sm font-bold text-lantern-ink">
              {say(lang, bi('Saturday long run', '周六长距离'))}
            </div>
            <div className="mt-1 text-xs text-lantern-ink-soft">
              {say(lang, bi('7:00 AM · Central Park', '早上 7:00 · 中央公园'))}
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
