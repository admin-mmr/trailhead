'use client'

import { useState } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { usePathname } from 'next/navigation'
import { Menu, X, Heart } from 'lucide-react'
import { useLang } from '@/lib/i18n/context'
import { clsx } from 'clsx'
import type { SessionUser } from '@/types'

const NAV_LINKS = [
  { href: '/',       keyEn: 'nav.home' as const },
  { href: '/join',   keyEn: 'nav.join' as const },
  { href: '/donate', keyEn: 'nav.donate' as const },
] as const

/** Profile avatar — shows initials in a colored circle */
function ProfileAvatar({ session, size = 32 }: { session: SessionUser; size?: number }) {
  const initials = [session.firstName, session.lastName]
    .filter(Boolean)
    .map(n => n![0].toUpperCase())
    .join('')
  const fallback = initials || session.email[0].toUpperCase()

  return (
    <div
      className="rounded-full bg-brand-gold flex items-center justify-center font-bold text-white flex-shrink-0"
      style={{ width: size, height: size, fontSize: size * 0.4 }}
    >
      {fallback}
    </div>
  )
}

/** Status badge shown next to user name or in mobile menu */
function StatusBadge({ status, lang }: { status: string; lang: string }) {
  const config: Record<string, { bg: string; text: string; labelEn: string; labelZh: string }> = {
    active:  { bg: 'bg-green-500/20', text: 'text-green-300', labelEn: 'Active',  labelZh: '有效' },
    pending: { bg: 'bg-yellow-500/20', text: 'text-yellow-300', labelEn: 'Pending', labelZh: '审核中' },
    expired: { bg: 'bg-red-500/20', text: 'text-red-300', labelEn: 'Expired',  labelZh: '已过期' },
    inactive:{ bg: 'bg-gray-500/20', text: 'text-gray-300', labelEn: 'Inactive', labelZh: '未激活' },
  }
  const c = config[status] ?? config.inactive
  return (
    <span className={clsx('text-[0.65rem] font-medium px-2 py-0.5 rounded-full', c.bg, c.text)}>
      {lang === 'zh' ? c.labelZh : c.labelEn}
    </span>
  )
}

export default function Navbar({
  session,
}: {
  session?: SessionUser | null
}) {
  const { lang, setLang, T } = useLang()
  const pathname = usePathname()
  const [open, setOpen] = useState(false)

  const isLoggedIn = !!session
  const isActive = session?.status === 'active'
  const isExpiredOrPending = session?.status === 'expired' || session?.status === 'pending'

  return (
    <header className="sticky top-0 z-50 shadow-md"
      style={{ background: 'linear-gradient(135deg, #C8102E 0%, #8C0E20 100%)' }}>

      {/* ── Status banner for expired/pending members ──────────────────────── */}
      {isLoggedIn && isExpiredOrPending && (
        <div className={clsx(
          'text-center text-sm py-2 px-4',
          session!.status === 'expired'
            ? 'bg-amber-50 text-amber-800 border-b border-amber-200'
            : 'bg-blue-50 text-blue-800 border-b border-blue-200'
        )}>
          {session!.status === 'expired'
            ? (lang === 'zh'
              ? '您的会员已过期。续费后即可恢复完整访问权限。'
              : 'Your membership has expired. Renew to restore full access.')
            : (lang === 'zh'
              ? '您的会员申请正在审核中。目前仅可浏览公开内容。'
              : 'Your membership is pending review. Only public content is available.')}
          {' '}
          <Link href="/join" className="font-semibold underline hover:opacity-80">
            {session!.status === 'expired'
              ? (lang === 'zh' ? '立即续费 →' : 'Renew now →')
              : (lang === 'zh' ? '查看状态 →' : 'Check status →')}
          </Link>
        </div>
      )}

      <nav className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex items-center justify-between h-16">

        {/* ── Left side: hamburger (mobile) + Logo ─────────────────────────── */}
        <div className="flex items-center gap-2">
          {/* Mobile hamburger — left corner */}
          <button
            className="md:hidden text-white p-2 -ml-2"
            onClick={() => setOpen(!open)}
            aria-label="Toggle menu"
          >
            {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>

          {/* Logo — real 岚 flag image; logged-in users go to portal */}
          <Link href={isLoggedIn && isActive ? '/portal' : '/'} className="flex items-center gap-3 group">
            <Image
              src="/images/mmr-logo.png"
              alt="MMR 岚 logo"
              width={38}
              height={38}
              className="rounded-full flex-shrink-0"
              style={{ objectFit: 'cover' }}
              priority
            />
            <div className="flex-col leading-tight hidden sm:flex">
              <span
                className={clsx('text-brand-gold tracking-wide', lang === 'zh' ? 'font-display font-semibold' : 'font-flag-script-bold')}
                style={{ fontSize: lang === 'zh' ? '1.15rem' : '1.35rem', lineHeight: 1.1 }}
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
        </div>

        {/* ── Right side: desktop nav + profile (or mobile profile) ────────── */}
        <div className="flex items-center gap-4">
          {/* ── Desktop links (hidden on mobile) ────────────────────────────── */}
          <div className="hidden md:flex items-center gap-6">
            {NAV_LINKS
              .filter(({ href }) => {
                if (isLoggedIn && isActive && href === '/join') return false
                return true
              })
              .map(({ href, keyEn }) => {
                // Logged-in active members: "Home" goes to portal dashboard
                const resolvedHref = (href === '/' && isLoggedIn && isActive) ? '/portal' : href
                return (
                  <Link
                    key={href}
                    href={resolvedHref}
                    className={clsx(
                      'text-sm font-medium transition-colors',
                      (pathname === resolvedHref || pathname === href)
                        ? 'text-brand-gold'
                        : 'text-white/80 hover:text-brand-gold-light',
                      href === '/donate' && 'flex items-center gap-1'
                    )}
                  >
                    {href === '/donate' && <Heart className="h-3.5 w-3.5" />}
                    {T(keyEn)}
                  </Link>
                )
              })}

            {/* Logout (desktop) */}
            {isLoggedIn && (
              <Link
                href="/api/auth/logout"
                className="text-sm text-white/50 hover:text-white transition-colors"
              >
                {T('nav.logout')}
              </Link>
            )}

            {/* Login button (desktop, not logged in) */}
            {!isLoggedIn && (
              <Link
                href="/login"
                className="bg-brand-gold text-white text-sm font-semibold px-4 py-2 rounded-full
                           hover:bg-brand-gold-light transition-colors shadow-sm"
              >
                {T('nav.login')}
              </Link>
            )}

            {/* Language toggle (desktop) */}
            <button
              onClick={() => setLang(lang === 'en' ? 'zh' : 'en')}
              className="text-white/70 hover:text-brand-gold text-sm border border-brand-gold/40
                         rounded-full px-3 py-1 transition-colors"
              aria-label="Switch language"
            >
              {lang === 'en' ? '中文' : 'EN'}
            </button>
          </div>

          {/* ── Profile avatar — always visible (desktop + mobile) ──────────── */}
          {isLoggedIn && session ? (
            <Link
              href="/portal/profile"
              className={clsx(
                'flex items-center gap-2 border border-brand-gold/40 rounded-full pl-1 pr-3 py-1 transition-colors',
                pathname === '/portal/profile'
                  ? 'bg-brand-gold/10'
                  : 'hover:bg-brand-gold/10'
              )}
              title={lang === 'zh' ? '编辑个人信息' : 'Edit Profile'}
            >
              <ProfileAvatar session={session} size={28} />
              <span className="text-sm font-medium text-brand-gold hidden sm:inline">
                {session.firstName ?? session.email.split('@')[0]}
              </span>
              <StatusBadge status={session.status} lang={lang} />
            </Link>
          ) : (
            /* Mobile-only login button */
            <Link
              href="/login"
              className="md:hidden bg-brand-gold text-white text-sm font-semibold px-4 py-1.5 rounded-full
                         hover:bg-brand-gold-light transition-colors shadow-sm"
            >
              {T('nav.login')}
            </Link>
          )}
        </div>
      </nav>

      {/* ── Mobile menu (slides down from hamburger) ──────────────────────── */}
      {open && (
        <div className="md:hidden border-t border-brand-gold/20 px-4 py-4 flex flex-col gap-4 animate-fade-in"
          style={{ background: '#8C0E20' }}>

          {NAV_LINKS
            .filter(({ href }) => {
              if (isLoggedIn && isActive && href === '/join') return false
              return true
            })
            .map(({ href, keyEn }) => {
              const resolvedHref = (href === '/' && isLoggedIn && isActive) ? '/portal' : href
              return (
                <Link
                  key={href}
                  href={resolvedHref}
                  onClick={() => setOpen(false)}
                  className={clsx(
                    'text-sm font-medium flex items-center gap-2',
                    (pathname === resolvedHref || pathname === href) ? 'text-brand-gold' : 'text-white/80'
                  )}
                >
                  {href === '/donate' && <Heart className="h-3.5 w-3.5" />}
                  {T(keyEn)}
                </Link>
              )
            })}

          {isLoggedIn ? (
            <Link href="/api/auth/logout" className="text-sm text-white/50">
              {T('nav.logout')}
            </Link>
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
