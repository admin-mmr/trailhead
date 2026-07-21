import { Heart } from 'lucide-react'

export function DoneStep({ lang, eventId }: { lang: string; eventId: string | null }) {
  return (
    <div className="text-center py-6">
      <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
        <Heart className="w-9 h-9 text-green-500" />
      </div>
      <h2 className="text-2xl font-bold text-[#0A2342] mb-2">
        {lang === 'zh' ? '感谢您的捐赠！' : 'Thank You for Your Donation!'}
      </h2>
      <p className="text-gray-600 mb-4">
        {lang === 'zh'
          ? '您的慷慨支持帮助我们为跑步社区做更多的事情。'
          : 'Your generous support helps us do more for our running community.'}
      </p>
      {eventId && (
        <div className="inline-block bg-gray-50 border border-gray-200 rounded-xl px-6 py-3 mb-6">
          <p className="text-xs text-gray-500 uppercase tracking-wider">
            {lang === 'zh' ? '参考号' : 'Reference Number'}
          </p>
          <p className="text-lg font-mono font-bold text-[#0A2342] mt-1">{eventId}</p>
        </div>
      )}
      <div className="flex gap-4 justify-center mt-4">
        <a href="/"
          className="bg-[#0A2342] text-white px-8 py-3 rounded-xl font-semibold hover:bg-[#0d2d55] transition-colors">
          {lang === 'zh' ? '返回首页' : 'Back to Home'}
        </a>
      </div>
    </div>
  )
}
