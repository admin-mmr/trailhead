'use client'

import Link from 'next/link'
import { useLang } from '@/lib/i18n/context'

/**
 * MistyMountainScene — SVG illustration matching newbeerunning.org's footer style.
 * A misty mountain range at sunrise with runner silhouettes, rendered in the MMR
 * flag's crimson-to-gold gradient palette.
 */
function MistyMountainScene() {
  return (
    <svg
      viewBox="0 0 1440 220"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      style={{ display: 'block', width: '100%' }}
      preserveAspectRatio="xMidYMid slice"
    >
      <defs>
        <linearGradient id="skyGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"   stopColor="#8C0E20" />
          <stop offset="55%"  stopColor="#C8102E" />
          <stop offset="100%" stopColor="#D4A843" />
        </linearGradient>
        <linearGradient id="farMtn" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"   stopColor="#8C0E20" stopOpacity="0.7" />
          <stop offset="100%" stopColor="#5A0A15" stopOpacity="0.9" />
        </linearGradient>
        <linearGradient id="nearMtn" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"   stopColor="#3D0610" />
          <stop offset="100%" stopColor="#1A0206" />
        </linearGradient>
        <radialGradient id="sunGlow" cx="50%" cy="80%" r="50%">
          <stop offset="0%"   stopColor="#F2D57E" stopOpacity="0.65" />
          <stop offset="60%"  stopColor="#D4A843" stopOpacity="0.2" />
          <stop offset="100%" stopColor="#C8102E" stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* Sky */}
      <rect width="1440" height="220" fill="url(#skyGrad)" />

      {/* Sun glow */}
      <ellipse cx="720" cy="190" rx="500" ry="120" fill="url(#sunGlow)" />
      <ellipse cx="720" cy="172" rx="26" ry="16" fill="#F2D57E" opacity="0.85" />
      <ellipse cx="720" cy="172" rx="44" ry="26" fill="#D4A843" opacity="0.28" />

      {/* Far mountains */}
      <path
        d="M0,180 L120,100 L200,140 L320,70 L440,120 L520,85 L620,115 L700,55
           L760,90 L840,60 L920,110 L1020,75 L1120,105 L1220,65 L1320,100 L1440,80 L1440,220 L0,220 Z"
        fill="url(#farMtn)"
        opacity="0.75"
      />

      {/* Mid mountains */}
      <path
        d="M0,200 L80,140 L180,175 L280,120 L400,155 L500,105 L600,145 L680,95
           L780,130 L880,100 L980,140 L1080,90 L1180,130 L1280,110 L1380,145 L1440,120 L1440,220 L0,220 Z"
        fill="url(#nearMtn)"
        opacity="0.55"
      />

      {/* Foreground ridge */}
      <path
        d="M0,210 L200,165 L380,185 L560,155 L720,170 L900,148 L1080,168 L1260,155 L1440,165 L1440,220 L0,220 Z"
        fill="#1A0206"
      />

      {/* Runner silhouettes — left group */}
      <g transform="translate(260,168) scale(0.9)" opacity="0.9">
        <circle cx="0" cy="-32" r="5" fill="#1A0206"/>
        <line x1="0" y1="-27" x2="0" y2="-10" stroke="#1A0206" strokeWidth="3"/>
        <line x1="0" y1="-22" x2="-9" y2="-14" stroke="#1A0206" strokeWidth="2.5"/>
        <line x1="0" y1="-22" x2="9" y2="-16" stroke="#1A0206" strokeWidth="2.5"/>
        <line x1="0" y1="-10" x2="-8" y2="0" stroke="#1A0206" strokeWidth="2.5"/>
        <line x1="0" y1="-10" x2="7" y2="-2" stroke="#1A0206" strokeWidth="2.5"/>
        <line x1="7" y1="-2" x2="13" y2="0" stroke="#1A0206" strokeWidth="2"/>
      </g>
      <g transform="translate(310,165) scale(0.85)" opacity="0.85">
        <circle cx="0" cy="-32" r="5" fill="#1A0206"/>
        <line x1="0" y1="-27" x2="0" y2="-10" stroke="#1A0206" strokeWidth="3"/>
        <line x1="0" y1="-22" x2="10" y2="-15" stroke="#1A0206" strokeWidth="2.5"/>
        <line x1="0" y1="-22" x2="-8" y2="-18" stroke="#1A0206" strokeWidth="2.5"/>
        <line x1="0" y1="-10" x2="9" y2="0" stroke="#1A0206" strokeWidth="2.5"/>
        <line x1="0" y1="-10" x2="-6" y2="-3" stroke="#1A0206" strokeWidth="2.5"/>
        <line x1="-6" y1="-3" x2="-12" y2="0" stroke="#1A0206" strokeWidth="2"/>
      </g>
      <g transform="translate(356,167) scale(0.8)" opacity="0.8">
        <circle cx="0" cy="-32" r="5" fill="#1A0206"/>
        <line x1="0" y1="-27" x2="0" y2="-10" stroke="#1A0206" strokeWidth="3"/>
        <line x1="0" y1="-22" x2="-10" y2="-16" stroke="#1A0206" strokeWidth="2.5"/>
        <line x1="0" y1="-22" x2="8" y2="-17" stroke="#1A0206" strokeWidth="2.5"/>
        <line x1="0" y1="-10" x2="-9" y2="0" stroke="#1A0206" strokeWidth="2.5"/>
        <line x1="0" y1="-10" x2="6" y2="-2" stroke="#1A0206" strokeWidth="2.5"/>
        <line x1="6" y1="-2" x2="11" y2="0" stroke="#1A0206" strokeWidth="2"/>
      </g>

      {/* Runner silhouettes — right group */}
      <g transform="translate(1080,163) scale(0.88)" opacity="0.85">
        <circle cx="0" cy="-32" r="5" fill="#1A0206"/>
        <line x1="0" y1="-27" x2="0" y2="-10" stroke="#1A0206" strokeWidth="3"/>
        <line x1="0" y1="-22" x2="9" y2="-14" stroke="#1A0206" strokeWidth="2.5"/>
        <line x1="0" y1="-22" x2="-9" y2="-16" stroke="#1A0206" strokeWidth="2.5"/>
        <line x1="0" y1="-10" x2="8" y2="0" stroke="#1A0206" strokeWidth="2.5"/>
        <line x1="0" y1="-10" x2="-7" y2="-3" stroke="#1A0206" strokeWidth="2.5"/>
        <line x1="-7" y1="-3" x2="-13" y2="0" stroke="#1A0206" strokeWidth="2"/>
      </g>
      <g transform="translate(1128,165) scale(0.82)" opacity="0.8">
        <circle cx="0" cy="-32" r="5" fill="#1A0206"/>
        <line x1="0" y1="-27" x2="0" y2="-10" stroke="#1A0206" strokeWidth="3"/>
        <line x1="0" y1="-22" x2="-10" y2="-15" stroke="#1A0206" strokeWidth="2.5"/>
        <line x1="0" y1="-22" x2="8" y2="-18" stroke="#1A0206" strokeWidth="2.5"/>
        <line x1="0" y1="-10" x2="-9" y2="0" stroke="#1A0206" strokeWidth="2.5"/>
        <line x1="0" y1="-10" x2="7" y2="-2" stroke="#1A0206" strokeWidth="2.5"/>
        <line x1="7" y1="-2" x2="12" y2="0" stroke="#1A0206" strokeWidth="2"/>
      </g>
    </svg>
  )
}

const FOUNDING_YEAR = 2024

export default function Footer() {
  const { lang } = useLang()
  const year = new Date().getFullYear()

  return (
    <footer className="mt-20" style={{ background: '#0D0105' }}>

      {/* Illustrated mountain scene — mirrors newbeerunning.org footer style */}
      <div style={{ lineHeight: 0 }}>
        <MistyMountainScene />
      </div>

      {/* Info columns */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10
                      grid grid-cols-1 md:grid-cols-4 gap-8 text-sm"
           style={{ color: 'rgba(255,255,255,0.6)' }}>

        {/* Brand */}
        <div className="md:col-span-2">
          <div className="flex items-center gap-2.5 mb-3">
            <svg width="28" height="28" viewBox="0 0 40 40" aria-hidden="true">
              <circle cx="20" cy="20" r="20" fill="#C8102E" />
              <circle cx="20" cy="20" r="18.5" fill="none" stroke="#D4A843" strokeWidth="1" />
              <text x="20" y="28" textAnchor="middle" fontSize="22"
                fontFamily="'Cormorant Garamond','Noto Sans SC',serif"
                fontWeight="600" fill="#D4A843">岚</text>
            </svg>
            <span style={{ fontFamily: "'Cormorant Garamond', Georgia, serif", fontSize: '1.1rem', color: '#D4A843', fontWeight: 600 }}>
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
              { href: 'mailto:info@mmrunners.org',           label: 'Email' },
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
      <div style={{ borderTop: '1px solid rgba(212,168,67,0.15)', padding: '1.25rem 1.5rem', textAlign: 'center', fontSize: '0.72rem', color: 'rgba(255,255,255,0.3)', lineHeight: 1.6, maxWidth: '860px', margin: '0 auto' }}>
        © {FOUNDING_YEAR}–{year} Misty Mountain Runners. 岚山跑团 （Misty Mountain Runners, MMR) is a not-for-profit organization recognized as tax-exempt under Section 501(c)(3) of the Internal Revenue Code. Contributions to MMR are tax deductible to the extent allowed by law.
      </div>
    </footer>
  )
}
