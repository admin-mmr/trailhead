'use client'

import Link from 'next/link'
import { useLang } from '@/lib/i18n/context'
import { ArrowRight, Users, Calendar, Trophy, Heart } from 'lucide-react'

const STATS = [
  { icon: Users,    keyEn: 'stats.members'  as const },
  { icon: Calendar, keyEn: 'stats.runs'     as const },
  { icon: Trophy,   keyEn: 'stats.team'     as const },
  { icon: Heart,    keyEn: 'stats.nonprofit' as const },
]

const FEATURED_EVENTS = [
  { date: 'MAR 22', title: 'Central Park Saturday Run', zh: '中央公园周六跑', location: 'Central Park, NYC' },
  { date: 'APR 6',  title: 'Brooklyn Half Prep Run',    zh: '布鲁克林半马备赛跑', location: 'Prospect Park, Brooklyn' },
  { date: 'APR 27', title: 'NYRR Five Borough Series',  zh: 'NYRR 五区系列赛', location: 'Various Boroughs' },
]

/** MMR logo mark — gold 岚 on crimson circle */
function LogoMark({ size = 64 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" aria-hidden="true">
      <circle cx="20" cy="20" r="20" fill="#C8102E" />
      <circle cx="20" cy="20" r="18.5" fill="none" stroke="#D4A843" strokeWidth="1.2" />
      <text x="20" y="28" textAnchor="middle" fontSize="22"
        fontFamily="'Cormorant Garamond','Noto Sans SC',serif"
        fontWeight="600" fill="#D4A843">岚</text>
    </svg>
  )
}

export default function HomePage() {
  const { T, lang } = useLang()

  return (
    <>
      {/* ── Hero ─────────────────────────────────────────────────────── */}
      <section
        className="relative min-h-[90vh] flex items-center overflow-hidden"
        style={{ background: 'linear-gradient(135deg, #8C0E20 0%, #C8102E 50%, #A07820 100%)' }}
      >
        {/* Animated gold + deep-crimson orbs */}
        <div className="absolute inset-0 pointer-events-none overflow-hidden">
          <div className="orb orb-1 absolute w-[640px] h-[640px] top-[-120px] right-[-120px]"
               style={{ background: '#D4A843' }} />
          <div className="orb orb-2 absolute w-[520px] h-[520px] bottom-[-160px] left-[-160px]"
               style={{ background: '#8C0E20' }} />
        </div>

        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-24">
          <div className="max-w-3xl">

            {/* Badge */}
            <div className="inline-flex items-center gap-2 mb-6 px-4 py-1.5 rounded-full border text-sm font-medium"
                 style={{ background: 'rgba(212,168,67,0.15)', color: '#F2D57E', borderColor: 'rgba(212,168,67,0.35)' }}>
              {lang === 'zh' ? '纽约华人跑步社区' : 'New York Chinese-American Runners'}
            </div>

            {/* Logo + heading row */}
            <div className="flex items-start gap-5 mb-6">
              <div className="mt-1 hidden sm:block">
                <LogoMark size={72} />
              </div>
              <h1
                className="leading-none"
                style={{
                  fontFamily: "'Cormorant Garamond', Georgia, serif",
                  fontWeight: 600,
                  fontSize: 'clamp(3rem, 7vw, 5.5rem)',
                  color: '#fff',
                  lineHeight: 1.05,
                }}
              >
                {lang === 'zh' ? (
                  <>
                    <span style={{ color: '#fff' }}>岚山</span>
                    <br />
                    <span className="text-gold-shimmer">跑团</span>
                  </>
                ) : (
                  <>
                    <span style={{ color: '#fff' }}>Misty Mountain</span>
                    <br />
                    <span className="text-gold-shimmer">Runners</span>
                  </>
                )}
              </h1>
            </div>

            <p className="text-xl leading-relaxed mb-10 max-w-xl" style={{ color: 'rgba(255,255,255,0.75)' }}>
              {lang === 'zh'
                ? '每周集体训练，NYRR 官方队伍，社区互助，欢迎所有水平的跑者。'
                : 'Weekly group runs, NYRR official club team, and a welcoming community for runners of all paces.'}
            </p>

            <div className="flex flex-wrap gap-4">
              <Link href="/join"
                    className="flex items-center gap-2 font-semibold px-6 py-3 rounded-full transition-all duration-200 shadow-md"
                    style={{ background: '#D4A843', color: '#fff' }}
                    onMouseEnter={e => (e.currentTarget.style.background = '#F2D57E')}
                    onMouseLeave={e => (e.currentTarget.style.background = '#D4A843')}>
                {T('hero.cta.join')} <ArrowRight className="h-4 w-4" />
              </Link>
              <Link href="/events"
                    className="font-semibold px-6 py-3 rounded-full border-2 transition-all duration-200"
                    style={{ borderColor: 'rgba(255,255,255,0.5)', color: '#fff', background: 'transparent' }}
                    onMouseEnter={e => { e.currentTarget.style.background = '#fff'; e.currentTarget.style.color = '#C8102E' }}
                    onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#fff' }}>
                {T('hero.cta.events')}
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* ── Stats bar ────────────────────────────────────────────────── */}
      <section className="bg-white py-12 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
            {STATS.map(({ icon: Icon, keyEn }) => (
              <div key={keyEn} className="text-center">
                <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl mb-3"
                     style={{ background: 'rgba(200,16,46,0.08)' }}>
                  <Icon className="h-6 w-6" style={{ color: '#C8102E' }} />
                </div>
                <p className="font-bold text-lg" style={{ color: '#C8102E' }}>{T(keyEn)}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Upcoming Events Preview ───────────────────────────────────── */}
      <section className="py-20" style={{ background: '#FFF8F2' }}>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-end justify-between mb-10">
            <div>
              <h2 className="section-title"
                  style={{ fontFamily: "'Cormorant Garamond', Georgia, serif" }}>
                {T('events.title')}
              </h2>
              <p className="text-gray-500">
                {lang === 'zh' ? '加入我们的下一次跑步' : 'Join us for our next run'}
              </p>
            </div>
            <Link href="/events"
                  className="font-medium text-sm hover:underline flex items-center gap-1"
                  style={{ color: '#C8102E' }}>
              {lang === 'zh' ? '查看全部' : 'View all'} <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
          <div className="grid md:grid-cols-3 gap-6">
            {FEATURED_EVENTS.map(event => (
              <div key={event.date} className="card p-6 flex gap-5"
                   style={{ borderColor: 'rgba(212,168,67,0.25)' }}>
                {/* Date chip — crimson */}
                <div className="flex-shrink-0 rounded-xl w-16 h-16 flex flex-col items-center justify-center text-white"
                     style={{ background: '#C8102E' }}>
                  <span className="text-xs font-medium opacity-75">{event.date.split(' ')[0]}</span>
                  <span className="text-2xl font-bold leading-none">{event.date.split(' ')[1]}</span>
                </div>
                <div>
                  <h3 className="font-semibold text-gray-900 leading-snug">
                    {lang === 'zh' ? event.zh : event.title}
                  </h3>
                  <p className="text-gray-500 text-sm mt-1">{event.location}</p>
                  <Link href="/events"
                        className="text-sm font-medium mt-2 inline-block hover:underline"
                        style={{ color: '#C8102E' }}>
                    {T('events.details')} →
                  </Link>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Join CTA ──────────────────────────────────────────────────── */}
      <section className="py-20"
               style={{ background: 'linear-gradient(135deg, #8C0E20 0%, #C8102E 100%)' }}>
        <div className="max-w-3xl mx-auto px-4 text-center">
          <h2 style={{ fontFamily: "'Cormorant Garamond', Georgia, serif", fontSize: 'clamp(2rem,5vw,3rem)', fontWeight: 600, color: '#fff', marginBottom: '1rem' }}>
            {lang === 'zh' ? '加入岚山跑团' : 'Ready to Run With Us?'}
          </h2>
          <p className="text-lg mb-8" style={{ color: 'rgba(255,255,255,0.75)' }}>
            {lang === 'zh'
              ? '个人会员 $30/年，家庭会员 $50/年。包含 NYRR 队伍资格及专属活动。'
              : 'Individual $30/yr · Family $50/yr. NYRR team eligibility + member-only events.'}
          </p>
          <Link href="/join"
                className="inline-flex items-center gap-2 font-semibold px-8 py-3 rounded-full shadow-md transition-all duration-200"
                style={{ background: '#D4A843', color: '#fff' }}
                onMouseEnter={e => (e.currentTarget.style.background = '#F2D57E')}
                onMouseLeave={e => (e.currentTarget.style.background = '#D4A843')}>
            {T('join.cta')} <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </section>
    </>
  )
}
