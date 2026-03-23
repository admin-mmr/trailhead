'use client'

import Link from 'next/link'
import { useLang } from '@/lib/i18n/context'
import { ArrowRight, Users, Calendar, Trophy, Heart, ExternalLink } from 'lucide-react'

const STATS = [
  { icon: Users,    keyEn: 'stats.members'   as const },
  { icon: Calendar, keyEn: 'stats.runs'      as const },
  { icon: Trophy,   keyEn: 'stats.team'      as const },
  { icon: Heart,    keyEn: 'stats.nonprofit' as const },
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
              <Link href="/login"
                    className="font-semibold px-6 py-3 rounded-full border-2 transition-all duration-200"
                    style={{ borderColor: 'rgba(255,255,255,0.5)', color: '#fff', background: 'transparent' }}
                    onMouseEnter={e => { e.currentTarget.style.background = '#fff'; e.currentTarget.style.color = '#C8102E' }}
                    onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#fff' }}>
                {lang === 'zh' ? '会员登录' : 'Member Login'}
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

      {/* ── Official Website ──────────────────────────────────────────── */}
      <section className="py-20" style={{ background: '#FFF8F2' }}>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="mb-10">
            <h2 className="section-title"
                style={{ fontFamily: "'Cormorant Garamond', Georgia, serif" }}>
              {lang === 'zh' ? '官方网站' : 'Our Official Website'}
            </h2>
            <p className="text-gray-500 mb-2">
              {lang === 'zh'
                ? '岚山跑团官方网站：'
                : 'Visit our main website at '}
              <a href="http://www.mmrunners.org" target="_blank" rel="noopener noreferrer"
                 className="font-medium hover:underline inline-flex items-center gap-1"
                 style={{ color: '#C8102E' }}>
                www.mmrunners.org <ExternalLink className="h-3.5 w-3.5" />
              </a>
            </p>
            <p className="text-gray-400 text-sm">
              {lang === 'zh'
                ? '本站是会员互动平台，提供会员管理、成绩查询等动态功能，更多功能即将推出。'
                : 'This site is an interactive member portal for dynamic content — membership management, NYRR results, photo services, and more features coming soon.'}
            </p>
          </div>

          <a href="http://www.mmrunners.org" target="_blank" rel="noopener noreferrer"
             className="inline-flex items-center gap-2 px-5 py-3 rounded-xl font-medium text-white transition-opacity hover:opacity-90"
             style={{ background: '#C8102E' }}>
            {lang === 'zh' ? '访问官方网站' : 'Visit www.mmrunners.org'}
            <ExternalLink className="h-4 w-4" />
          </a>
        </div>
      </section>

      {/* ── Coming Soon ───────────────────────────────────────────────── */}
      <section className="py-16" style={{ background: '#fff' }}>
        <div className="max-w-4xl mx-auto px-4 text-center">
          <h2 style={{ fontFamily: "'Cormorant Garamond', Georgia, serif", fontSize: 'clamp(1.75rem,4vw,2.5rem)', fontWeight: 600, color: '#1a1a1a', marginBottom: '0.75rem' }}>
            {lang === 'zh' ? '更多功能即将推出' : 'More Features Coming Soon'}
          </h2>
          <p className="text-gray-500 text-lg mb-10">
            {lang === 'zh'
              ? '我们正在开发更多会员专属功能，敬请期待。'
              : 'We are actively building new member features. Stay tuned.'}
          </p>
          <div className="grid sm:grid-cols-3 gap-6">
            {[
              { en: 'Photo Service', zh: '照片服务', desc_en: 'Find your race photos by face & bib recognition', desc_zh: '通过面部和号码布识别查找您的赛跑照片' },
              { en: 'Race Results', zh: '比赛成绩', desc_en: 'Track your NYRR results and team standings', desc_zh: '追踪您的 NYRR 成绩和队伍排名' },
              { en: 'Member Events', zh: '会员活动', desc_en: 'Members-only events, training plans, and group runs', desc_zh: '会员专属活动、训练计划和集体跑步' },
            ].map(f => (
              <div key={f.en} className="rounded-xl p-6 text-left"
                   style={{ background: '#FFF8F2', border: '1px solid rgba(212,168,67,0.2)' }}>
                <div className="w-8 h-8 rounded-lg mb-3 flex items-center justify-center"
                     style={{ background: 'rgba(200,16,46,0.08)' }}>
                  <span style={{ color: '#C8102E', fontSize: '1rem' }}>✦</span>
                </div>
                <h3 className="font-semibold text-gray-900 mb-1">{lang === 'zh' ? f.zh : f.en}</h3>
                <p className="text-gray-500 text-sm">{lang === 'zh' ? f.desc_zh : f.desc_en}</p>
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
