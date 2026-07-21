import { CheckCircle } from 'lucide-react'

interface DoneStepProps {
  lang: string
  memberId: string | null
  eventId: string | null
}

export function DoneStep({ lang, memberId, eventId }: DoneStepProps) {
  return (
    <div className="text-center py-6">
      <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
        <CheckCircle className="w-9 h-9 text-green-500" />
      </div>
      <h2 className="text-2xl font-bold text-[#0A2342] mb-2">
        {lang === 'zh' ? '申请已提交！' : 'Application Submitted!'}
      </h2>
      <p className="text-gray-600 mb-4">
        {lang === 'zh'
          ? '我们正在审核您的付款。通常在 1–2 个工作日内完成。审核通过后，您将收到确认邮件。'
          : 'We\'re reviewing your payment. This typically takes 1–2 business days. You\'ll receive a confirmation email once approved.'}
      </p>
      <div className="flex flex-wrap justify-center gap-4 mb-6">
        {memberId && (
          <div className="inline-block bg-green-50 border border-green-200 rounded-xl px-6 py-3">
            <p className="text-xs text-gray-500 uppercase tracking-wider">
              {lang === 'zh' ? '会员编号' : 'Member ID'}
            </p>
            <p className="text-lg font-mono font-bold text-green-700 mt-1">{memberId}</p>
          </div>
        )}
        {eventId && (
          <div className="inline-block bg-gray-50 border border-gray-200 rounded-xl px-6 py-3">
            <p className="text-xs text-gray-500 uppercase tracking-wider">
              {lang === 'zh' ? '参考号' : 'Reference Number'}
            </p>
            <p className="text-lg font-mono font-bold text-[#0A2342] mt-1">{eventId}</p>
          </div>
        )}
      </div>
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-800 text-left">
        <strong>{lang === 'zh' ? '温馨提示：' : 'Reminder: '}</strong>
        {lang === 'zh'
          ? '如果您尚未上传付款截图，请登录后前往会员中心补交。这将帮助我们更快激活您的会员资格。'
          : 'If you skipped the screenshot upload, you can still submit it from your member portal after logging in. It helps us activate your membership faster.'}
      </div>
      <a href="/login"
        className="mt-6 inline-block bg-[#0A2342] text-white px-8 py-3 rounded-xl font-semibold hover:bg-[#0d2d55] transition-colors">
        {lang === 'zh' ? '登录会员中心' : 'Log In to Member Portal'}
      </a>
    </div>
  )
}
