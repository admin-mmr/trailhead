'use client'

import { useLang } from '@/lib/i18n/context'
import { bi, say, type Bi } from './copy'

/**
 * Why members join — Option C's three-card row.
 *
 * Each card carries its Chinese subtitle permanently beneath the English
 * heading (the mockup's `h3 small`), so the section reads as bilingual even
 * when the toggle is set to English.
 */
const BENEFITS: { icon: string; title: Bi; body: Bi }[] = [
  {
    icon: '◈',
    title: bi('NYRR team eligibility', 'NYRR 队伍资格'),
    body: bi(
      'Score for MMR in NYRR races and show up in team standings. Results sync into your portal automatically.',
      '代表岚山跑团参加 NYRR 积分赛，出现在队伍排名中。成绩会自动同步到你的会员中心。',
    ),
  },
  {
    icon: '◎',
    title: bi('Race photos, found for you', '比赛照片自动识别'),
    body: bi(
      'Bib and face recognition sweeps every club shoot, so your photos land in your gallery without the scrolling.',
      '号码布与人脸识别会扫描每次跑团拍摄，你的照片会直接进入相册，无需翻找。',
    ),
  },
  {
    icon: '◐',
    title: bi('Bilingual by default', '中英双语社区'),
    body: bi(
      'Every route brief, announcement, and form in both English and Chinese — no one gets left out of the group chat.',
      '每一条路线说明、通知和表单都提供中英双语——不让任何人被群聊落下。',
    ),
  },
]

export default function HomeBenefits() {
  const { lang } = useLang()

  return (
    <section className="px-4 py-20 sm:px-6 lg:px-8 lg:py-24">
      <div className="mx-auto max-w-6xl">
        <div className="mx-auto mb-12 max-w-2xl text-center">
          <p className="text-[0.7rem] font-semibold uppercase tracking-[0.2em] text-lantern-gold">
            {say(lang, bi('Member benefits', '会员权益'))}
          </p>
          <h2 className="mt-3.5 font-lantern text-3xl font-bold leading-[1.08] tracking-tight text-lantern-ink sm:text-4xl">
            {say(lang, bi('Why members join and stay.', '为什么会员加入并留下来。'))}
          </h2>
          <p className="mt-4 text-base leading-relaxed text-lantern-ink-soft sm:text-lg">
            {say(lang, bi(
              'Dues keep group runs free, the race team registered, and the volunteer table stocked.',
              '会费让团跑保持免费、让参赛队伍完成注册、让志愿者服务台物资充足。',
            ))}
          </p>
        </div>

        <div className="grid gap-5 md:grid-cols-3">
          {BENEFITS.map(b => (
            <div
              key={b.title.en}
              className="group rounded-[22px] border border-lantern-line bg-white p-8 transition-all hover:-translate-y-1 hover:border-lantern-gold-foil/50 hover:shadow-[0_18px_40px_-16px_rgba(140,14,32,0.16)]"
            >
              <div
                aria-hidden="true"
                className="mb-5 flex h-12 w-12 items-center justify-center rounded-2xl border border-lantern-gold-foil/30 bg-gradient-to-br from-lantern-gold-tint to-[#FFF9EC] text-xl text-lantern-gold"
              >
                {b.icon}
              </div>
              <h3 className="font-lantern text-lg font-bold text-lantern-ink">
                {say(lang, b.title)}
              </h3>
              <p className="mt-3 text-sm leading-relaxed text-lantern-ink-soft">{say(lang, b.body)}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
