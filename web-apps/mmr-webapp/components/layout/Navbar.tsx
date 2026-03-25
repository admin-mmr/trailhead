'use client'

import { useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Menu, X, Shield, Heart } from 'lucide-react'
import { useLang } from '@/lib/i18n/context'
import { clsx } from 'clsx'
import type { SessionUser } from '@/types'

const NAV_LINKS = [
  { href: '/',       keyEn: 'nav.home' as const },
  { href: '/join',   keyEn: 'nav.join' as const },
  { href: '/donate', keyEn: 'nav.donate' as const },
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

/** Profile avatar — shows photo placeholder (initials) or a colored circle */
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

/** Status badge shown in the mobile menu or profile dropdown */
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
  isAdmin = false,
}: {
  session?: SessionUser | null
  isAdmin?: boolean
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
          {NAV_LINKS
            .filter(({ href }) => {
              // Hide "Join" for logged-in active members (they don't need it)
              if (isLoggedIn && isActive && href === '/join') return false
              return true
            })
            .map(({ href, keyEn }) => (
              <Link
                key={href}
                href={href}
                className={clsx(
                  'text-sm font-medium transition-colors',
                  pathname === href
                    ? 'text-brand-gold'
                    : 'text-white/80 hover:text-brand-gold-light',
                  href === '/donate' && 'flex items-center gap-1'
                )}
              >
                {href === '/donate' && <Heart className="h-3.5 w-3.5" />}
                {T(keyEn)}
              </Link>
            ))}

          {isLoggedIn && session ? (
            <>
              {/* Portal link — only for active members */}
              {isActive && (
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
              )}

              {/* Admin link */}
              {isAdmin && (
                <Link
                  href="/admin"
                  className={clsx(
                    'flex items-center gap-1 text-sm font-medium transition-colors',
                    pathname.startsWith('/admin')
                      ? 'text-brand-gold'
                      : 'text-white/80 hover:text-brand-gold-light'
                  )}
                >
                  <Shield className="h-3.5 w-3.5" />
                  Admin
                </Link>
              )}

              {/* Profile avatar — clickable to edit profile */}
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
                <span className="text-sm font-medium text-brand-gold">
                  {session.firstName ?? session.email.split('@')[0]}
                </span>
                <StatusBadge status={session.status} lang={lang} />
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

          {/* Profile card in mobile menu */}
          {isLoggedIn && session && (
            <Link
              href="/portal/profile"
              onClick={() => setOpen(false)}
              className="flex items-center gap-3 p-3 rounded-xl bg-white/10"
            >
              <ProfileAvatar session={session} size={36} />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-white truncate">
                  {[session.firstName, session.lastName].filter(Boolean).join(' ') || session.email}
                </p>
                <p className="text-[0.65rem] text-white/50 truncate">{session.memberId}</p>
              </div>
              <StatusBadge status={session.status} lang={lang} />
            </Link>
          )}

          {NAV_LINKS
            .filter(({ href }) => {
              if (isLoggedIn && isActive && href === '/join') return false
              return true
            })
            .map(({ href, keyEn }) => (
              <Link
                key={href}
                href={href}
                onClick={() => setOpen(false)}
                className={clsx(
                  'text-sm font-medium flex items-center gap-2',
                  pathname === href ? 'text-brand-gold' : 'text-white/80'
                )}
              >
                {href === '/donate' && <Heart className="h-3.5 w-3.5" />}
                {T(keyEn)}
              </Link>
            ))}

          {isLoggedIn ? (
            <>
              {isActive && (
                <Link
                  href="/portal"
                  onClick={() => setOpen(false)}
                  className="text-sm font-medium text-brand-gold"
                >
                  {T('nav.portal')} →
                </Link>
              )}
              {isAdmin && (
                <Link
                  href="/admin"
                  onClick={() => setOpen(false)}
                  className="flex items-center gap-2 text-sm font-medium text-brand-gold"
                >
                  <Shield className="h-3.5 w-3.5" /> Admin
                </Link>
              )}
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
