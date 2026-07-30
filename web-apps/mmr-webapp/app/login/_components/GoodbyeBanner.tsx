import { useState, useEffect } from 'react'
import { LogOut } from 'lucide-react'
import type { Lang } from '@/lib/i18n/translations'

// Shown for 8s after a sign-out (/login?goodbye=1), then removes itself.
export function GoodbyeBanner({ lang }: { lang: Lang }) {
  const [visible, setVisible] = useState(true)

  useEffect(() => {
    const timer = setTimeout(() => setVisible(false), 8000)
    return () => clearTimeout(timer)
  }, [])

  if (!visible) return null

  return (
    <div className="absolute top-0 left-0 right-0 z-10 animate-fade-in">
      <div className="bg-gradient-to-r from-emerald-500 to-teal-500 text-white px-4 py-4 text-center shadow-lg">
        <div className="flex items-center justify-center gap-2 mb-1">
          <LogOut className="h-4 w-4" />
          <span className="font-semibold">
            {lang === 'zh' ? '感谢您的使用！' : 'Thank you and see you again!'}
          </span>
        </div>
        <p className="text-white/80 text-sm">
          {lang === 'zh'
            ? '您已成功退出登录。期待下次再见！'
            : 'You have been signed out successfully. We look forward to seeing you again!'}
        </p>
      </div>
    </div>
  )
}
