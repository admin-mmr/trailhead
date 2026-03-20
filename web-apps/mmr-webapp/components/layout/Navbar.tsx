'use client'

import { useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Menu, X } from 'lucide-react'
import { useLang } from '@/lib/i18n/context'
import { clsx } from 'clsx'

const NAV_LINKS = [
  { href: '/',        keyEn: 'nav.home'   as const },
  { href: '/events',  keyEn: 'nav.events' as const },
  { href: '/blog',    keyEn: 'nav.blog'   as const },
  { href: '/join',    keyEn: 'nav.join'   as const },
] as const

/** MMR logo — the 岚 calligraphy character styled in gold on crimson, matching the flag */
function MMRLogo({ size = 40 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 40 40"
      aria-label="MMR logo"
      style={{ display: 'inline-block', flexShrink: 0 }}
    >
      {/* Crimson circular background */}
      <circle cx="20" cy="20" r="20" fill="#C8102E" />
      {/* Gold ring */}
      <circle cx="20" cy="20" r="18.5" fill="none" stroke="#D4A843" strokeWidth="1" />
      {/* 岚 character in gold — Cormorant Garamond / calligraphic style */}
      <text
        x="20"
        y="28"
        textAnchor="middle"
        fontSize="22"
        fontFamily="'Cormorant Garamond', 'Noto Sans SC', serif"
        fontWeight="600"
        fill="#D4A843"
        style={{ userSelect: 'none' }}
      >
        岚
      </text>
    </svg>
  )
}

export default function Navbar({ isLoggedIn = false }: { isLoggedIn?: boolean }) {
  const { lang, setLang, T } = useLang()
  const pathname = usePathname()
  const [open, setOpen] = useState(false)

  return (
    <header className="sticky top-0 z-50 shadow-md"
      style={{ background: 'linear-gradient(135deg, #C8102E 0%, #8C0E20 100%)' }}>
      <nav className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex items-center justify-between h-16">

        {/* ── Logo ──────────────────────────────────────────────────────── */}
        <Link href="/" className="flex items-center gap-3 group">
          <MMRLogo size={38} />
          <div className="flex flex-col leading-tight hidden sm:flex">
            <span
              className="text-brand-gold font-display font-semibold tracking-wide"
              style={{ fontFamily: "'Cormorant Garamond', Georgia, serif", fontSize: '1.15rem', lineHeight: 1.1 }}
            >
              {lang === 'zh' ? '岚山跑团' : 'Misty Mountain Runners'}
            </span>
            {lang === 'en' && (
              <span className="text-white/60 text-[0.62rem] tracking-widest uppercase">
                MMRunners · 岚山
              </span>
            )}
          </div>
        </Link>

        {/* ── Desktop links ──────────────────────────────────────────────── */}
        <div className="hidden md:flex items-center gap-6">
          {NAV_LINKS.map(({ href, keyEn }) => (
            <Link
              key={href}
              href={href}
              className={clsx(
                'text-sm font-medium transition-colors',
                pathname === href
                  ? 'text-brand-gold'
                  : 'text-white/80 hover:text-brand-gold-light'
              )}
            >
              {T(keyEn)}
            </Link>
          ))}

          {isLoggedIn ? (
            <>
              <Link
                href="/portal"
                className={clsx(
                  'text-sm font-medium transition-colors',
                  pathname.startsWith('/portal')
                    ? 'text-brand-gold'
                    : 'text-white/80 hover:text-brand-gold-light'
                )}
              >
                {T('nav.portal')}
              </Link>
              <Link
                href="/api/auth/logout"
                className="text-sm text-white/50 hover:text-white transition-colors"
              >
                {T('nav.logout')}
              </Link>
            </>
          ) : (
            <Link
              href="/login"
              className="bg-brand-gold text-white text-sm font-semibold px-4 py-2 rounded-full
                         hover:bg-brand-gold-light transition-colors shadow-sm"
            >
              {T('nav.login')}
            </Link>
          )}

          {/* Language toggle */}
          <button
            onClick={() => setLang(lang === 'en' ? 'zh' : 'en')}
            className="text-white/70 hover:text-brand-gold text-sm border border-brand-gold/40
                       rounded-full px-3 py-1 transition-colors"
            aria-label="Switch language"
          >
            {lang === 'en' ? '中文' : 'EN'}
          </button>
        </div>

        {/* ── Mobile menu button ─────────────────────────────────────────── */}
        <button
          className="md:hidden text-white p-2"
          onClick={() => setOpen(!open)}
          aria-label="Toggle menu"
        >
          {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </nav>

      {/* ── Mobile menu ────────────────────────────────────────────────── */}
      {open && (
        <div className="md:hidden border-t border-brand-gold/20 px-4 py-4 flex flex-col gap-4 animate-fade-in"
          style={{ background: '#8C0E20' }}>
          {NAV_LINKS.map(({ href, keyEn }) => (
            <Link
              key={href}
              href={href}
              onClick={() => setOpen(false)}
              className={clsx(
                'text-sm font-medium',
                pathname === href ? 'text-brand-gold' : 'text-white/80'
              )}
            >
              {T(keyEn)}
            </Link>
          ))}
          {isLoggedIn ? (
            <>
              <Link href="/portal" onClick={() => setOpen(false)} className="text-sm text-white/80">
                {T('nav.portal')}
              </Link>
              <Link href="/api/auth/logout" className="text-sm text-white/50">
                {T('nav.logout')}
              </Link>
            </>
          ) : (
            <Link
              href="/login"
              onClick={() => setOpen(false)}
              className="text-sm font-semibold text-brand-gold"
            >
              {T('nav.login')}
            </Link>
          )}
          <button
            onClick={() => { setLang(lang === 'en' ? 'zh' : 'en'); setOpen(false) }}
            className="text-white/70 text-sm text-left"
          >
            {lang === 'en' ? '切换到中文' : 'Switch to English'}
          </button>
        </div>
      )}
    </header>
  )
}
