'use client'

import Link from 'next/link'
import { Mountain } from 'lucide-react'
import { useLang } from '@/lib/i18n/context'

export default function Footer() {
  const { lang } = useLang()

  return (
    <footer className="bg-brand-navy-dark text-white/70 mt-20">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12 grid grid-cols-1 md:grid-cols-4 gap-8">
        {/* Brand */}
        <div className="md:col-span-2">
          <div className="flex items-center gap-2 mb-3">
            <Mountain className="h-5 w-5 text-brand-orange" />
            <span className="font-bold text-white text-lg">
              {lang === 'zh' ? '岚山跑团' : 'Misty Mountain Runners'}
            </span>
          </div>
          <p className="text-sm leading-relaxed">
            {lang === 'zh'
              ? '纽约华人跑步社区，501(c)(3) 非盈利组织。'
              : "New York's premier Chinese-American running community. 501(c)(3) nonprofit."}
          </p>
          <div className="flex gap-4 mt-4">
            <a href="https://www.instagram.com/mmrunners" target="_blank" rel="noopener noreferrer"
               className="text-white/50 hover:text-brand-orange transition-colors text-sm">Instagram</a>
            <a href="https://www.strava.com" target="_blank" rel="noopener noreferrer"
               className="text-white/50 hover:text-brand-orange transition-colors text-sm">Strava</a>
            <a href="mailto:info@mmrunners.org"
               className="text-white/50 hover:text-brand-orange transition-colors text-sm">Email</a>
          </div>
        </div>

        {/* Links */}
        <div>
          <h3 className="text-white font-semibold text-sm mb-3">
            {lang === 'zh' ? '快速链接' : 'Quick Links'}
          </h3>
          <ul className="space-y-2 text-sm">
            {[
              { href: '/events', en: 'Events', zh: '活动' },
              { href: '/join',   en: 'Join',   zh: '加入' },
              { href: '/blog',   en: 'News',   zh: '新闻' },
              { href: '/portal', en: 'Member Portal', zh: '会员中心' },
            ].map(link => (
              <li key={link.href}>
                <Link href={link.href} className="hover:text-white transition-colors">
                  {lang === 'zh' ? link.zh : link.en}
                </Link>
              </li>
            ))}
          </ul>
        </div>

        {/* NYRR */}
        <div>
          <h3 className="text-white font-semibold text-sm mb-3">NYRR</h3>
          <ul className="space-y-2 text-sm">
            <li>
              <a href="https://www.nyrr.org" target="_blank" rel="noopener noreferrer"
                 className="hover:text-white transition-colors">NYRR.org</a>
            </li>
            <li>
              <a href="https://results.nyrr.org" target="_blank" rel="noopener noreferrer"
                 className="hover:text-white transition-colors">
                {lang === 'zh' ? '比赛成绩' : 'Race Results'}
              </a>
            </li>
            <li>
              <Link href="/portal/nyrr" className="hover:text-white transition-colors">
                {lang === 'zh' ? '我的成绩' : 'My Results'}
              </Link>
            </li>
          </ul>
        </div>
      </div>

      <div className="border-t border-white/10 py-4 text-center text-xs text-white/40">
        © {new Date().getFullYear()} Misty Mountain Runners · 岚山跑团 · All rights reserved.
      </div>
    </footer>
  )
}
