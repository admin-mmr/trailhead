'use client'

import Link from 'next/link'
import { useLang } from '@/lib/i18n/context'
import { ArrowRight, Users, Calendar, Trophy, Heart } from 'lucide-react'

const STATS = [
  { icon: Users,    keyEn: 'stats.members' as const },
  { icon: Calendar, keyEn: 'stats.runs' as const },
  { icon: Trophy,   keyEn: 'stats.team' as const },
  { icon: Heart,    keyEn: 'stats.nonprofit' as const },
]

const FEATURED_EVENTS = [
  { date: 'MAR 22', title: 'Central Park Saturday Run', zh: '中央公园周六跑', location: 'Central Park, NYC' },
  { date: 'APR 6',  title: 'Brooklyn Half Prep Run',    zh: '布鲁克林半马备赛跑', location: 'Prospect Park, Brooklyn' },
  { date: 'APR 27', title: 'NYRR Five Borough Series',  zh: 'NYRR 五区系列赛', location: 'Various Boroughs' },
]

export default function HomePage() {
  const { T, lang } = useLang()

  return (
    <>
      {/* ── Hero ────────────────────────────────────────────── */}
      <section className="relative min-h-[90vh] bg-gradient-to-br from-brand-navy via-brand-navy to-brand-navy-dark flex items-center overflow-hidden">
        {/* Animated orbs */}
        <div className="absolute inset-0 pointer-events-none overflow-hidden">
          <div className="orb orb-1 absolute w-[600px] h-[600px] bg-brand-orange top-[-100px] right-[-100px]" />
          <div className="orb orb-2 absolute w-[500px] h-[500px] bg-brand-navy-light bottom-[-150px] left-[-150px]" />
        </div>

        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-24">
          <div className="max-w-3xl">
            <div className="inline-block bg-brand-orange/20 text-brand-orange text-sm font-medium px-4 py-1.5 rounded-full mb-6 border border-brand-orange/30">
              {lang === 'zh' ? '纽约华人跑步社区' : 'New York Chinese-American Runners'}
            </div>
            <h1 className="text-5xl sm:text-7xl font-bold text-white leading-tight mb-4">
              {lang === 'zh' ? '岚山跑团' : 'Misty Mountain'}
              <br />
              <span className="text-brand-orange">
                {lang === 'zh' ? '' : 'Runners'}
              </span>
            </h1>
            <p className="text-white/70 text-xl leading-relaxed mb-10 max-w-xl">
              {lang === 'zh'
                ? '每周集体训练，NYRR 官方队伍，社区互助，欢迎所有水平的跑者。'
                : "Weekly group runs, NYRR official club team, and a welcoming community for runners of all paces."}
            </p>
            <div className="flex flex-wrap gap-4">
              <Link href="/join" className="btn-primary flex items-center gap-2">
                {T('hero.cta.join')} <ArrowRight className="h-4 w-4" />
              </Link>
              <Link href="/events" className="btn-secondary bg-transparent border-white/40 text-white hover:bg-white hover:text-brand-navy">
                {T('hero.cta.events')}
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* ── Stats ───────────────────────────────────────────── */}
      <section className="bg-white py-12 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
            {STATS.map(({ icon: Icon, keyEn }) => (
              <div key={keyEn} className="text-center">
                <div className="inline-flex items-center justify-center w-12 h-12 bg-brand-navy/10 rounded-xl mb-3">
                  <Icon className="h-6 w-6 text-brand-navy" />
                </div>
                <p className="font-bold text-brand-navy text-lg">{T(keyEn)}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Upcoming Events Preview ──────────────────────────── */}
      <section className="py-20 bg-gray-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-end justify-between mb-10">
            <div>
              <h2 className="section-title">{T('events.title')}</h2>
              <p className="text-gray-500">
                {lang === 'zh' ? '加入我们的下一次跑步' : 'Join us for our next run'}
              </p>
            </div>
            <Link href="/events" className="text-brand-orange font-medium text-sm hover:underline flex items-center gap-1">
              {lang === 'zh' ? '查看全部' : 'View all'} <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
          <div className="grid md:grid-cols-3 gap-6">
            {FEATURED_EVENTS.map(event => (
              <div key={event.date} className="card p-6 flex gap-5">
                <div className="flex-shrink-0 bg-brand-navy rounded-xl w-16 h-16 flex flex-col items-center justify-center text-white">
                  <span className="text-xs font-medium opacity-70">{event.date.split(' ')[0]}</span>
                  <span className="text-2xl font-bold leading-none">{event.date.split(' ')[1]}</span>
                </div>
                <div>
                  <h3 className="font-semibold text-gray-900 leading-snug">
                    {lang === 'zh' ? event.zh : event.title}
                  </h3>
                  <p className="text-gray-500 text-sm mt-1">{event.location}</p>
                  <Link href="/events" className="text-brand-orange text-sm font-medium mt-2 inline-block hover:underline">
                    {T('events.details')} →
                  </Link>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Join CTA ─────────────────────────────────────────── */}
      <section className="py-20 bg-brand-navy">
        <div className="max-w-3xl mx-auto px-4 text-center">
          <h2 className="text-4xl font-bold text-white mb-4">
            {lang === 'zh' ? '加入岚山跑团' : 'Ready to Run With Us?'}
          </h2>
          <p className="text-white/70 text-lg mb-8">
            {lang === 'zh'
              ? '个人会员 $30/年，家庭会员 $50/年。包含 NYRR 队伍资格及专属活动。'
              : 'Individual $30/yr · Family $50/yr. NYRR team eligibility + member-only events.'}
          </p>
          <Link href="/join" className="btn-primary inline-flex items-center gap-2">
            {T('join.cta')} <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </section>
    </>
  )
}
