'use client'

import { AlertCircle } from 'lucide-react'
import { useLang } from '@/lib/i18n/context'

export default function NyrrPage() {
  const { lang } = useLang()

  const title = lang === 'en' ? 'NYRR Results' : 'NYRR 成绩'
  const message = lang === 'en' 
    ? 'NYRR race results integration coming soon. Sync your running data from NYRR events.'
    : 'NYRR 赛事成绩集成即将推出。同步您的 NYRR 比赛数据。'

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 flex items-center justify-center p-4">
      <div className="bg-white rounded-lg shadow-lg p-8 max-w-md w-full text-center">
        <AlertCircle className="mx-auto mb-4 text-amber-500" size={48} />
        <h1 className="text-2xl font-bold text-slate-900 mb-2">{title}</h1>
        <p className="text-slate-600 mb-6">{message}</p>
        <div className="inline-block px-4 py-2 bg-amber-50 border border-amber-200 rounded-lg">
          <p className="text-sm text-amber-800 font-medium">
            {lang === 'en' ? '🚧 Coming Soon' : '🚧 敬请期待'}
          </p>
        </div>
      </div>
    </div>
  )
}
