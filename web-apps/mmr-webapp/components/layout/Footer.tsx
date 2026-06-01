'use client'

import Link from 'next/link'
import Image from 'next/image'
import { useLang } from '@/lib/i18n/context'

const FOUNDING_YEAR = 2015

export default function Footer() {
  const { lang } = useLang()
  const year = new Date().getFullYear()

  return (
    <footer className="mt-20" style={{ background: '#0D0105' }}>

      {/* Info columns */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10
                      grid grid-cols-1 md:grid-cols-4 gap-8 text-sm"
           style={{ color: 'rgba(255,255,255,0.78)' }}>

        {/* Brand — real logo + club name */}
        <div className="md:col-span-2">
          <div className="flex items-center gap-3 mb-3">
            <Image
              src="/images/mmr-logo.png"
              alt="MMR 岚 logo"
              width={36}
              height={36}
              className="rounded-full flex-shrink-0 border"
              style={{ borderColor: 'rgba(212,168,67,0.4)', objectFit: 'cover' }}
            />
            <span className={lang === 'zh' ? '' : 'font-flag-script-bold'} style={{
              fontFamily: lang === 'zh' ? "'Cormorant Garamond', Georgia, serif" : undefined,
              fontSize: lang === 'zh' ? '1.15rem' : '1.4rem',
              color: '#D4A843',
              fontWeight: lang === 'zh' ? 600 : 400,
            }}>
              {lang === 'zh' ? '岚山跑团' : 'Misty Mountain Runners'}
            </span>
          </div>
          <p className="leading-relaxed mb-4">
            {lang === 'zh'
              ? '纽约华人跑步社区，NYRR 官方队伍，501(c)(3) 非盈利组织。'
              : "New York's Chinese-American running community · NYRR official club team · 501(c)(3) nonprofit."}
          </p>
          <div className="flex gap-4">
            {[
              { href: 'https://www.instagram.com/mmrunners', label: 'Instagram' },
              { href: 'https://www.strava.com',              label: 'Strava' },
              { href: 'mailto:admin@mmrunners.org',          label: 'Email' },
            ].map(({ href, label }) => (
              <a key={label} href={href}
                 target={href.startsWith('http') ? '_blank' : undefined}
                 rel={href.startsWith('http') ? 'noopener noreferrer' : undefined}
                 style={{ color: 'inherit', transition: 'color 0.2s' }}
                 onMouseEnter={e => (e.currentTarget.style.color = '#D4A843')}
                 onMouseLeave={e => (e.currentTarget.style.color = '')}>
                {label}
              </a>
            ))}
          </div>
        </div>

        {/* Quick Links */}
        <div>
          <h3 style={{ color: '#fff', fontWeight: 600, fontSize: '0.875rem', marginBottom: '0.75rem', letterSpacing: '0.05em' }}>
            {lang === 'zh' ? '快速链接' : 'Quick Links'}
          </h3>
          <ul className="space-y-2">
            {[
              { href: '/join',   en: 'Join Us',       zh: '加入' },
              { href: '/portal', en: 'Member Portal', zh: '会员中心' },
              { href: '/faq',    en: 'FAQ',           zh: '常见问题' },
            ].map(link => (
              <li key={link.href}>
                <Link href={link.href}
                  style={{ color: 'inherit', transition: 'color 0.2s' }}
                  onMouseEnter={e => (e.currentTarget.style.color = '#D4A843')}
                  onMouseLeave={e => (e.currentTarget.style.color = '')}>
                  {lang === 'zh' ? link.zh : link.en}
                </Link>
              </li>
            ))}
          </ul>
        </div>

        {/* NYRR */}
        <div>
          <h3 style={{ color: '#fff', fontWeight: 600, fontSize: '0.875rem', marginBottom: '0.75rem', letterSpacing: '0.05em' }}>
            NYRR
          </h3>
          <ul className="space-y-2">
            <li>
              <a href="https://www.nyrr.org" target="_blank" rel="noopener noreferrer"
                 style={{ color: 'inherit', transition: 'color 0.2s' }}
                 onMouseEnter={e => (e.currentTarget.style.color = '#D4A843')}
                 onMouseLeave={e => (e.currentTarget.style.color = '')}>
                NYRR.org
              </a>
            </li>
            <li>
              <a href="https://results.nyrr.org" target="_blank" rel="noopener noreferrer"
                 style={{ color: 'inherit', transition: 'color 0.2s' }}
                 onMouseEnter={e => (e.currentTarget.style.color = '#D4A843')}
                 onMouseLeave={e => (e.currentTarget.style.color = '')}>
                {lang === 'zh' ? '比赛成绩' : 'Race Results'}
              </a>
            </li>
            <li>
              <Link href="/portal/nyrr"
                style={{ color: 'inherit', transition: 'color 0.2s' }}
                onMouseEnter={e => (e.currentTarget.style.color = '#D4A843')}
                onMouseLeave={e => (e.currentTarget.style.color = '')}>
                {lang === 'zh' ? '我的成绩' : 'My Results'}
              </Link>
            </li>
          </ul>
        </div>
      </div>

      {/* Copyright bar */}
      <div style={{ borderTop: '1px solid rgba(212,168,67,0.15)', padding: '1.25rem 1.5rem', textAlign: 'center', fontSize: '0.72rem', color: 'rgba(255,255,255,0.55)', lineHeight: 1.6, maxWidth: '860px', margin: '0 auto' }}>
        © {FOUNDING_YEAR}–{year} Misty Mountain Runners. 岚山跑团 （Misty Mountain Runners, MMR) is a not-for-profit organization recognized as tax-exempt under Section 501(c)(3) of the Internal Revenue Code. Contributions to MMR are tax deductible to the extent allowed by law.
        <div style={{ marginTop: '0.5rem', fontSize: '0.62rem', color: 'rgba(255,255,255,0.35)', letterSpacing: '0.04em' }}>
          v{process.env.NEXT_PUBLIC_APP_VERSION} · {process.env.NEXT_PUBLIC_BUILD_SHA} · {process.env.NEXT_PUBLIC_BUILD_TIME}
        </div>
      </div>
    </footer>
  )
}
