'use client'

import { useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Menu, X, Mountain } from 'lucide-react'
import { useLang } from '@/lib/i18n/context'
import { clsx } from 'clsx'

const NAV_LINKS = [
  { href: '/',        keyEn: 'nav.home'   as const },
  { href: '/events',  keyEn: 'nav.events' as const },
  { href: '/blog',    keyEn: 'nav.blog'   as const },
  { href: '/join',    keyEn: 'nav.join'   as const },
] as const

export default function Navbar({ isLoggedIn = false }: { isLoggedIn?: boolean }) {
  const { lang, setLang, T } = useLang()
  const pathname = usePathname()
  const [open, setOpen] = useState(false)

  return (
    <header className="sticky top-0 z-50 bg-brand-navy/95 backdrop-blur-sm shadow-md">
      <nav className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex items-center justify-between h-16">
        {/* Logo */}
        <Link href="/" className="flex items-center gap-2 text-white font-bold text-lg">
          <Mountain className="h-6 w-6 text-brand-orange" />
          <span className="hidden sm:block">
            {lang === 'zh' ? '岚山跑团' : 'MMRunners'}
          </span>
        </Link>

        {/* Desktop links */}
        <div className="hidden md:flex items-center gap-6">
          {NAV_LINKS.map(({ href, keyEn }) => (
            <Link
              key={href}
              href={href}
              className={clsx(
                'text-sm font-medium transition-colors',
                pathname === href
                  ? 'text-brand-orange'
                  : 'text-white/80 hover:text-white'
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
                    ? 'text-brand-orange'
                    : 'text-white/80 hover:text-white'
                )}
              >
                {T('nav.portal')}
              </Link>
              <Link
                href="/api/auth/logout"
                className="text-sm text-white/60 hover:text-white transition-colors"
              >
                {T('nav.logout')}
              </Link>
            </>
          ) : (
            <Link
              href="/login"
              className="bg-brand-orange text-white text-sm font-semibold px-4 py-2 rounded-full hover:bg-brand-orange-light transition-colors"
            >
              {T('nav.login')}
            </Link>
          )}

          {/* Language toggle */}
          <button
            onClick={() => setLang(lang === 'en' ? 'zh' : 'en')}
            className="text-white/70 hover:text-white text-sm border border-white/30 rounded-full px-3 py-1 transition-colors"
            aria-label="Switch language"
          >
            {lang === 'en' ? '中文' : 'EN'}
          </button>
        </div>

        {/* Mobile menu button */}
        <button
          className="md:hidden text-white p-2"
          onClick={() => setOpen(!open)}
          aria-label="Toggle menu"
        >
          {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </nav>

      {/* Mobile menu */}
      {open && (
        <div className="md:hidden bg-brand-navy-dark border-t border-white/10 px-4 py-4 flex flex-col gap-4 animate-fade-in">
          {NAV_LINKS.map(({ href, keyEn }) => (
            <Link
              key={href}
              href={href}
              onClick={() => setOpen(false)}
              className={clsx(
                'text-sm font-medium',
                pathname === href ? 'text-brand-orange' : 'text-white/80'
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
              <Link href="/api/auth/logout" className="text-sm text-white/60">
                {T('nav.logout')}
              </Link>
            </>
          ) : (
            <Link
              href="/login"
              onClick={() => setOpen(false)}
              className="text-sm font-semibold text-brand-orange"
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
