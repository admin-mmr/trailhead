'use client'

import Link from 'next/link'
import { useLang } from '@/lib/i18n/context'
import { bi, say } from './copy'

export interface Pricing {
  individual: number
  family: number
  familyUpgrade: number
}

/**
 * Closing join CTA (Option C's crimson slab).
 *
 * Prices are passed in from the config table, never hardcoded here — the same
 * keys Stripe Checkout recomputes against (IndividualPrice / FamilyPrice /
 * FamilyUpgradePrice), so the marketing page can't quote a number the
 * checkout won't charge.
 */
export default function HomeJoinCta({ pricing }: { pricing: Pricing }) {
  const { lang } = useLang()

  const tiers = [
    { amount: pricing.individual, label: bi('Individual', '个人') },
    { amount: pricing.family, label: bi('Family', '家庭') },
    { amount: pricing.familyUpgrade, label: bi('Family upgrade', '家庭升级') },
  ]

  return (
    <section className="px-4 py-20 sm:px-6 lg:px-8 lg:py-24">
      <div className="relative mx-auto max-w-6xl overflow-hidden rounded-[30px] bg-gradient-to-br from-brand-crimson-dark via-brand-crimson to-[#D9385A] px-8 py-16 text-center shadow-[0_24px_60px_-22px_rgba(140,14,32,0.6)] sm:px-14 lg:py-20">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute left-1/2 top-[-160px] h-[520px] w-[520px] -translate-x-1/2 opacity-10"
          style={{
            backgroundImage: "url('/images/mmr-logo.png')",
            backgroundSize: 'contain',
            backgroundRepeat: 'no-repeat',
            backgroundPosition: 'center',
          }}
        />

        <div className="relative">
          <h2 className="font-zh text-3xl font-black text-white sm:text-4xl lg:text-5xl">加入岚山跑团</h2>
          <p className="mx-auto mt-4 max-w-[46ch] text-base leading-relaxed text-white/80 sm:text-lg">
            {say(lang, bi(
              "Join online in about two minutes. Membership runs a full year from the day it's approved.",
              '线上加入大约只需两分钟。会员资格自审核通过之日起满一年。',
            ))}
          </p>

          <div className="mt-8 flex flex-wrap justify-center gap-3">
            {tiers.map(tier => (
              <div
                key={tier.label.en}
                className="rounded-2xl border border-white/25 bg-white/10 px-6 py-4 backdrop-blur-sm"
              >
                <b className="block font-lantern text-2xl font-extrabold tracking-tight text-white">
                  ${tier.amount}
                </b>
                <span className="text-xs font-medium text-white/75">
                  {tier.label.en} / {tier.label.zh}
                </span>
              </div>
            ))}
          </div>

          <div className="mt-9">
            <Link
              href="/join"
              className="inline-flex items-center gap-2 rounded-full bg-[#F0CB70] px-8 py-4 text-[0.95rem] font-semibold text-[#3A2A06] transition-colors hover:bg-[#F8DE9B]"
            >
              {say(lang, bi('Become a member', '成为会员'))} →
            </Link>
          </div>
        </div>
      </div>
    </section>
  )
}
