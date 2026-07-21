import Image from 'next/image'
import type { MemberInfo, PayForm, PlanInfo } from './shared'

type PayMethod = 'card' | 'zelle' | 'venmo'

interface PaymentStepProps {
  lang: string
  currentPlan: PlanInfo
  payMethod: PayMethod
  setPayMethod: (m: PayMethod) => void
  memberId: string | null
  info: MemberInfo
  payForm: PayForm
  setPayForm: React.Dispatch<React.SetStateAction<PayForm>>
  stripeTestMode: boolean
  zelleHandle: string
  venmoHandle: string
  submitting: boolean
  onSubmit: (e: React.FormEvent) => void
  prevStep: () => void
}

export function PaymentStep(props: PaymentStepProps) {
  const {
    lang, currentPlan, payMethod, setPayMethod, memberId, info,
    payForm, setPayForm, stripeTestMode, zelleHandle, venmoHandle,
    submitting, onSubmit, prevStep,
  } = props

  return (
    <form onSubmit={onSubmit}>
      <h2 className="text-xl font-semibold text-[#0A2342] mb-2">
        {lang === 'zh' ? '付款方式' : 'Complete Your Payment'}
      </h2>

      {/* Member ID banner — shown after enrollment */}
      {memberId && (
        <div className="mb-4 p-4 bg-green-50 border border-green-200 rounded-xl">
          <p className="text-sm font-semibold text-green-800">
            {lang === 'zh' ? '您的会员编号：' : 'Your Member ID: '}
            <span className="font-mono text-base">{memberId}</span>
          </p>
          {payMethod !== 'card' && (
            <p className="text-xs text-green-700 mt-1">
              {lang === 'zh'
                ? '请在付款备注中包含此编号，以便我们自动处理您的会费。'
                : 'Please include this ID in your payment memo so we can auto-process your membership.'}
            </p>
          )}
        </div>
      )}

      <p className="text-sm text-gray-500 mb-6">
        {lang === 'zh'
          ? `请支付 $${currentPlan.amount}，可使用银行卡（Stripe）、Zelle 或 Venmo。`
          : `Please pay $${currentPlan.amount} by card (Stripe), Zelle, or Venmo.`}
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
              ${payMethod === m.id ? 'border-[#F47B20] bg-orange-50 text-[#F47B20]' : 'border-gray-200 text-gray-500 hover:border-gray-300'}`}>
            {m.label}
          </button>
        ))}
      </div>

      {/* Card: Stripe Checkout hand-off */}
      {payMethod === 'card' && (
        <div className="bg-gray-50 rounded-xl p-6 mb-6 text-center">
          <p className="text-2xl font-bold text-[#F47B20] mb-2">${currentPlan.amount}</p>
          <p className="text-sm text-gray-600">
            {lang === 'zh'
              ? '点击下方按钮后，您将跳转到 Stripe 安全支付页面完成付款。付款成功后会员资格将自动激活，无需上传截图。'
              : "You'll be redirected to Stripe's secure checkout to complete your payment. Your membership activates automatically once payment succeeds — no screenshot needed."}
          </p>
          {stripeTestMode && (
            <p className="mt-3 px-3 py-2 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-700 font-semibold">
              {lang === 'zh'
                ? '⚠️ 测试模式 — 付款为模拟操作，不会产生真实扣款，会员资格不会正式生效。'
                : '⚠️ Test mode — payments are simulated, your card will not be charged, and no real membership is granted.'}
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
          <p className="text-2xl font-bold text-[#F47B20]">${currentPlan.amount}</p>
          <p className="text-xs text-gray-500 mt-2">
            {lang === 'zh'
              ? `备注请填写: ${memberId ?? ''} ${info.firstName} ${info.lastName} ${currentPlan.labelZh}`
              : `Memo: ${memberId ?? ''} ${info.firstName} ${info.lastName} – ${currentPlan.label}`}
          </p>
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
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#0A2342]" />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            {lang === 'zh' ? '付款日期' : 'Payment Date'} <span className="text-red-500">*</span>
          </label>
          <input required type="date" value={payForm.paymentDate}
            onChange={e => setPayForm(p => ({ ...p, paymentDate: e.target.value }))}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#0A2342]" />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            {lang === 'zh' ? '备注内容（填写的memo）' : 'Memo You Entered'}
          </label>
          <input value={payForm.memoField}
            onChange={e => setPayForm(p => ({ ...p, memoField: e.target.value }))}
            placeholder={memberId ? `e.g. ${memberId} John Smith Individual` : (lang === 'zh' ? '您在付款时输入的备注' : 'e.g. A0042 John Smith Individual Membership')}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#0A2342]" />
        </div>
        {payMethod === 'zelle' && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {lang === 'zh' ? '确认号后4位（可选）' : 'Last 4 Digits of Confirmation # (optional)'}
            </label>
            <input maxLength={4} value={payForm.last4}
              onChange={e => setPayForm(p => ({ ...p, last4: e.target.value.replace(/\D/g, '') }))}
              placeholder="1234"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#0A2342]" />
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
          className="flex-1 bg-[#0A2342] text-white py-3 rounded-xl font-semibold hover:bg-[#0d2d55] transition-colors disabled:opacity-50">
          {submitting
            ? (lang === 'zh' ? '提交中…' : 'Submitting…')
            : payMethod === 'card'
              ? (lang === 'zh' ? '前往银行卡付款 →' : 'Continue to Card Payment →')
              : (lang === 'zh' ? '提交付款信息' : 'Submit Payment Info →')}
        </button>
      </div>
    </form>
  )
}
