'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  LayoutDashboard, Trophy, User, Image, CalendarDays, Camera, ExternalLink
} from 'lucide-react'
import { useLang } from '@/lib/i18n/context'
import type { SessionUser } from '@/types'
import { clsx } from 'clsx'

const NAV = [
  { href: '/portal',          icon: LayoutDashboard, en: 'Dashboard',    zh: '概览', disabled: false },
  { href: '/portal/events',   icon: CalendarDays,    en: 'Race Calendar', zh: '赛事日历', disabled: false },
  { href: '/portal/nyrr',     icon: Trophy,          en: 'NYRR Results', zh: '比赛成绩', disabled: false },
  { href: '/portal/photos',   icon: Image,           en: 'Photos',       zh: '照片', disabled: true },
  { href: '/portal/profile',  icon: User,            en: 'Profile',      zh: '个人信息', disabled: false },
]

export default function PortalSidebar({
  session,
  galleryUrl,
}: {
  session: SessionUser
  /** External race-photo gallery (config-driven, already scheme-validated). */
  galleryUrl?: string | null
}) {
  const pathname = usePathname()
  const { lang }  = useLang()

  return (
    <aside className="hidden md:flex flex-col w-56 flex-shrink-0">
      {/* Member card */}
      <div className="bg-brand-navy rounded-2xl p-5 text-white mb-4">
        <div className="w-10 h-10 rounded-full bg-brand-orange flex items-center justify-center font-bold text-lg mb-3">
          {([session.firstName, session.lastName].filter(Boolean).join(' ') || session.email)[0].toUpperCase()}
        </div>
        <p className="font-semibold text-sm leading-tight">
          {[session.firstName, session.lastName].filter(Boolean).join(' ') || session.email}
        </p>
        <div className="mt-3 pt-3 border-t border-white/20">
          <p className="text-white/50 text-xs">{lang === 'zh' ? '会员编号' : 'Member ID'}</p>
          <p className="text-brand-orange font-mono text-sm font-bold">{session.memberId}</p>
        </div>
        <div className="mt-2">
          <span className={clsx(
            'text-xs font-medium px-2 py-0.5 rounded-full',
            session.status === 'active'
              ? 'bg-green-500/20 text-green-300'
              : 'bg-yellow-500/20 text-yellow-300'
          )}>
            {session.status === 'active'
              ? (lang === 'zh' ? '有效' : 'Active')
              : (lang === 'zh' ? '未激活' : 'Inactive')}
          </span>
        </div>
      </div>

      {/* Nav links */}
      <nav className="space-y-1">
        {NAV.map(({ href, icon: Icon, en, zh, disabled }) => {
          const active = pathname === href || (href !== '/portal' && pathname.startsWith(href))

          if (disabled) {
            return (
              <div
                key={href}
                className={clsx(
                  'flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors',
                  'text-gray-400 cursor-not-allowed opacity-50'
                )}
                title={lang === 'zh' ? '敬请期待' : 'Coming soon'}
              >
                <Icon className="h-4 w-4 flex-shrink-0" />
                {lang === 'zh' ? zh : en}
              </div>
            )
          }

          return (
            <Link
              key={href}
              href={href}
              className={clsx(
                'flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors',
                active
                  ? 'bg-brand-navy text-white'
                  : 'text-gray-600 hover:bg-gray-100 hover:text-brand-navy'
              )}
            >
              <Icon className="h-4 w-4 flex-shrink-0" />
              {lang === 'zh' ? zh : en}
            </Link>
          )
        })}

        {/* Race photos live on an external gallery, so this is an <a>, not a
            Link. The URL is admin-editable config — the server validates the
            scheme before it ever reaches this href. */}
        {galleryUrl && (
          <a
            href={galleryUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-gray-600 hover:bg-gray-100 hover:text-brand-navy transition-colors"
          >
            <Camera className="h-4 w-4 flex-shrink-0" />
            {lang === 'zh' ? '赛事照片' : 'Race Photos'}
            <ExternalLink className="h-3 w-3 flex-shrink-0 ml-auto text-gray-400" />
          </a>
        )}
      </nav>
    </aside>
  )
}
