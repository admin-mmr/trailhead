import Image from 'next/image'
import { Loader2 } from 'lucide-react'
import type { DonateForm, PayMethod } from './shared'

interface PaymentStepProps {
  lang: string
  donateAmount: number
  payMethod: PayMethod
  setPayMethod: (m: PayMethod) => void
  memberId: string | null
  payForm: DonateForm
  setPayForm: React.Dispatch<React.SetStateAction<DonateForm>>
  stripeTestMode: boolean
  zelleHandle: string
  venmoHandle: string
  submitting: boolean
  onSubmit: (e: React.FormEvent) => void
  prevStep: () => void
}

export function PaymentStep(props: PaymentStepProps) {
  const {
    lang, donateAmount, payMethod, setPayMethod, memberId, payForm, setPayForm,
    stripeTestMode, zelleHandle, venmoHandle, submitting, onSubmit, prevStep,
  } = props

  return (
    <form onSubmit={onSubmit}>
      <h2 className="text-xl font-semibold text-[#0A2342] mb-2">
        {lang === 'zh' ? '完成捐赠付款' : 'Complete Your Donation'}
      </h2>
      <p className="text-sm text-gray-500 mb-6">
        {lang === 'zh'
          ? `请支付 $${donateAmount}，可使用银行卡（Stripe）、Zelle 或 Venmo。`
          : `Please pay $${donateAmount} by card (Stripe), Zelle, or Venmo.`}
      </p>

      {/* Method toggle */}
      <div className="flex gap-3 mb-6">
        {([
          { id: 'card',  label: lang === 'zh' ? '银行卡' : 'Card' },
          { id: 'zelle', label: 'Zelle' },
          { id: 'venmo', label: 'Venmo' },
        ] as const).map(m => (
          <button key={m.id} type="button"
            onClick={() => setPayMethod(m.id)}
            className={`flex-1 py-2 rounded-xl border-2 font-semibold transition-colors
              ${payMethod === m.id ? 'border-[#C8102E] bg-red-50 text-[#C8102E]' : 'border-gray-200 text-gray-500 hover:border-gray-300'}`}>
            {m.label}
          </button>
        ))}
      </div>

      {/* Card: Stripe Checkout hand-off */}
      {payMethod === 'card' && (
        <div className="bg-gray-50 rounded-xl p-6 mb-6 text-center">
          <p className="text-2xl font-bold text-[#C8102E] mb-2">${donateAmount}</p>
          <p className="text-sm text-gray-600">
            {lang === 'zh'
              ? '点击下方按钮后，您将跳转到 Stripe 安全支付页面完成捐赠，无需上传截图。'
              : "You'll be redirected to Stripe's secure checkout to complete your donation — no screenshot needed."}
          </p>
          {stripeTestMode && (
            <p className="mt-3 px-3 py-2 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-700 font-semibold">
              {lang === 'zh'
                ? '⚠️ 测试模式 — 付款为模拟操作，不会产生真实扣款，不构成真实捐赠。'
                : '⚠️ Test mode — payments are simulated, your card will not be charged, and no real donation is made.'}
            </p>
          )}
        </div>
      )}

      {/* QR + instructions */}
      {payMethod !== 'card' && (
      <>
      <div className="bg-gray-50 rounded-xl p-6 mb-6 text-center">
        <div className="w-40 h-40 bg-white border-2 border-dashed border-gray-300 rounded-xl mx-auto flex items-center justify-center overflow-hidden">
          <Image
            src={`/images/mmr-${payMethod}.jpg`}
            alt={`${payMethod} QR code`}
            width={144}
            height={144}
            unoptimized
            className="object-contain"
            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
          />
        </div>
        <p className="text-sm text-gray-500 mt-2">
          {lang === 'zh' ? '扫描二维码付款' : 'Scan QR code to pay'}
        </p>
        <div className="mt-4 space-y-1">
          <p className="font-semibold text-[#0A2342] text-lg">
            {payMethod === 'zelle' ? zelleHandle : venmoHandle}
          </p>
          <p className="text-2xl font-bold text-[#C8102E]">${donateAmount}</p>
          <div className="mt-3 p-3 bg-amber-50 border border-amber-200 rounded-lg text-left">
            <p className="text-xs font-semibold text-amber-800 mb-1">
              {lang === 'zh' ? '备注提示：' : 'Memo hint:'}
            </p>
            <p className="text-sm text-amber-700 font-mono">
              {memberId ? `${memberId} donation` : `${payForm.firstName} ${payForm.lastName} donation`}
            </p>
            <p className="text-xs text-amber-600 mt-1">
              {lang === 'zh'
                ? '请在备注中包含您的会员编号（如有）和完整的 "donation" 一词。'
                : 'Please include your Member ID (if you have one) and the word "donation" in the memo.'}
            </p>
          </div>
        </div>
      </div>

      {/* Declaration form */}
      <div className="space-y-4">
        <h3 className="font-semibold text-gray-700">
          {lang === 'zh' ? '填写付款信息' : 'Record Your Payment'}
        </h3>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            {lang === 'zh' ? '付款人姓名' : 'Name on Payment Account'} <span className="text-red-500">*</span>
          </label>
          <input required value={payForm.payerName}
            onChange={e => setPayForm(p => ({ ...p, payerName: e.target.value }))}
            placeholder={lang === 'zh' ? '付款账户上的姓名' : 'Name shown on your Zelle/Venmo'}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#C8102E]" />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            {lang === 'zh' ? '付款日期' : 'Payment Date'} <span className="text-red-500">*</span>
          </label>
          <input required type="date" value={payForm.paymentDate}
            onChange={e => setPayForm(p => ({ ...p, paymentDate: e.target.value }))}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#C8102E]" />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            {lang === 'zh' ? '备注内容' : 'Memo You Entered'}
          </label>
          <input value={payForm.memoField}
            onChange={e => setPayForm(p => ({ ...p, memoField: e.target.value }))}
            placeholder={memberId ? `${memberId} donation` : `${payForm.firstName} ${payForm.lastName} donation`}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#C8102E]" />
        </div>
        {payMethod === 'zelle' && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {lang === 'zh' ? '确认号后4位（可选）' : 'Last 4 Digits of Confirmation # (optional)'}
            </label>
            <input maxLength={4} value={payForm.last4}
              onChange={e => setPayForm(p => ({ ...p, last4: e.target.value.replace(/\D/g, '') }))}
              placeholder="1234"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#C8102E]" />
          </div>
        )}
      </div>
      </>
      )}

      <div className="flex gap-4 mt-8">
        <button type="button" onClick={prevStep}
          className="flex-1 border border-gray-300 text-gray-700 py-3 rounded-xl font-semibold hover:bg-gray-50 transition-colors">
          {lang === 'zh' ? '返回' : '← Back'}
        </button>
        <button type="submit" disabled={submitting}
          className="flex-1 bg-[#C8102E] text-white py-3 rounded-xl font-semibold hover:bg-[#a00d25] transition-colors disabled:opacity-50 flex items-center justify-center gap-2">
          {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
          {submitting
            ? (lang === 'zh' ? '提交中…' : 'Submitting…')
            : payMethod === 'card'
              ? (lang === 'zh' ? '前往银行卡付款 →' : 'Continue to Card Payment →')
              : (lang === 'zh' ? '提交捐赠信息' : 'Submit Donation Info →')}
        </button>
      </div>
    </form>
  )
}
