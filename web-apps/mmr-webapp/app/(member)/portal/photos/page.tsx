'use client'

import { AlertCircle } from 'lucide-react'
import { useLang } from '@/lib/i18n/context'

export default function PhotosPage() {
  const { lang } = useLang()

  const title = lang === 'en' ? 'Photos' : '照片'
  const message = lang === 'en'
    ? 'Photo gallery and sharing coming soon. Upload and browse member photos from club events.'
    : '相册库和分享功能即将推出。上传并浏览俱乐部活动中的成员照片。'

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
