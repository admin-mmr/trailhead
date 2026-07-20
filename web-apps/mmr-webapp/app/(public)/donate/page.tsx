'use client'

import { useState, useRef, useEffect } from 'react'
import { useLang } from '@/lib/i18n/context'
import Image from 'next/image'
import { Heart, CheckCircle, Upload, CreditCard, Loader2 } from 'lucide-react'

type Step = 'amount' | 'payment' | 'proof' | 'done'

const STEP_ORDER: Step[] = ['amount', 'payment', 'proof', 'done']

const SUGGESTED_AMOUNTS = [10, 25, 50, 100]

export default function DonatePage() {
  const { lang } = useLang()
  const [step, setStep] = useState<Step>('amount')
  const [amount, setAmount] = useState<string>('')
  const [customAmount, setCustomAmount] = useState('')
  const [payMethod, setPayMethod] = useState<'card' | 'zelle' | 'venmo'>('card')
  const [payForm, setPayForm] = useState({
    payerName: '', paymentDate: '', memoField: '', last4: '',
    firstName: '', lastName: '', email: '', phone: '',
  })
  const [eventId, setEventId] = useState<string | null>(null)
  const [memberId, setMemberId] = useState<string | null>(null)
  const [proofFile, setProofFile] = useState<File | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  // If logged in, pre-fill info from session
  useEffect(() => {
    fetch('/api/members/me')
      .then(r => r.ok ? r.json() : null)
      .then(({ ok, data } = {}) => {
        if (ok && data) {
          setMemberId(data.memberId)
          setPayForm(prev => ({
            ...prev,
            firstName: data.firstName ?? '',
            lastName:  data.lastName ?? '',
            email:     data.email ?? '',
            phone:     data.phone ?? '',
          }))
        }
      })
      .catch(() => {})
  }, [])

  // Returning from a canceled Stripe Checkout (?canceled=1)
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('canceled')) {
      setError('Card payment was canceled — you can start again anytime. 银行卡付款已取消，您可以随时重新开始。')
    }
  }, [])

  const zelleHandle = process.env.NEXT_PUBLIC_ZELLE_HANDLE ?? 'runningmmr@gmail.com'
  const venmoHandle = process.env.NEXT_PUBLIC_VENMO_HANDLE ?? '@MMRunners'
  const stepIndex = STEP_ORDER.indexOf(step)
  const donateAmount = Number(amount || customAmount) || 0

  function nextStep() {
    setStep(STEP_ORDER[stepIndex + 1])
    setError('')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }
  function prevStep() {
    if (stepIndex > 0) {
      setStep(STEP_ORDER[stepIndex - 1])
      setError('')
    }
  }

  // Submit donation intent
  async function handlePaymentSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    setError('')
    try {
      const isCard = payMethod === 'card'
      const res = await fetch('/api/donations/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount: donateAmount,
          paymentMethod: payMethod,
          firstName: payForm.firstName,
          lastName: payForm.lastName,
          email: payForm.email,
          phone: payForm.phone,
          payerName: isCard ? `${payForm.firstName} ${payForm.lastName}`.trim() : payForm.payerName,
          paymentDate: isCard ? new Date().toISOString().slice(0, 10) : payForm.paymentDate,
          memoField: isCard ? `${memberId ?? ''} donation (Stripe)`.trim() : payForm.memoField,
          last4: payForm.last4,
          memberId: memberId,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Submission failed')
      if (isCard) {
        // Card path: hand off to Stripe Checkout — webhook confirms payment
        const co = await fetch('/api/payments/stripe/checkout', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ submissionId: data.submissionId, email: payForm.email }),
        })
        const coData = await co.json()
        if (!co.ok || !coData.url) throw new Error(coData.error ?? 'Could not start card checkout')
        window.location.href = coData.url
        return
      }
      setEventId(data.submissionId)
      nextStep()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setSubmitting(false)
    }
  }

  // Upload proof
  async function handleProofUpload(e: React.FormEvent) {
    e.preventDefault()
    if (!proofFile || !eventId) return
    setSubmitting(true)
    setError('')
    try {
      const fd = new FormData()
      fd.append('proof', proofFile)
      fd.append('submissionId', eventId)
      const res = await fetch('/api/payments/proof', { method: 'POST', body: fd })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Upload failed')
      nextStep()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Upload failed')
    } finally {
      setSubmitting(false)
    }
  }

  // Progress indicator
  const STEPS = [
    { id: 'amount',  label: lang === 'zh' ? '金额' : 'Amount',  icon: <Heart className="w-4 h-4" /> },
    { id: 'payment', label: lang === 'zh' ? '付款' : 'Pay',     icon: <CreditCard className="w-4 h-4" /> },
    { id: 'proof',   label: lang === 'zh' ? '凭证' : 'Proof',   icon: <Upload className="w-4 h-4" /> },
    { id: 'done',    label: lang === 'zh' ? '完成' : 'Done',     icon: <CheckCircle className="w-4 h-4" /> },
  ]

  return (
    <main className="min-h-screen bg-gray-50 py-12">
      <div className="max-w-2xl mx-auto px-4">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 bg-[#C8102E] rounded-2xl mb-4">
            <Heart className="h-7 w-7 text-white" />
          </div>
          <h1 className="text-3xl font-bold text-[#0A2342]">
            {lang === 'zh' ? '支持岚山跑团' : 'Support Misty Mountain Runners'}
          </h1>
          <p className="text-gray-500 mt-2">
            {lang === 'zh'
              ? '您的捐赠帮助我们组织更多跑步活动和社区项目。'
              : 'Your donation helps us organize more runs and community programs.'}
          </p>
          <p className="text-xs text-gray-400 mt-1">501(c)(3) nonprofit</p>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8">
          {/* Progress Bar */}
          <div className="flex items-center justify-between mb-10">
            {STEPS.map((s, i) => {
              const done = i < stepIndex
              const active = s.id === step
              return (
                <div key={s.id} className="flex items-center flex-1">
                  <div className={`flex flex-col items-center ${i < STEPS.length - 1 ? 'flex-1' : ''}`}>
                    <div className={`w-9 h-9 rounded-full flex items-center justify-center text-sm font-semibold border-2 transition-colors
                      ${done ? 'bg-green-500 border-green-500 text-white' : active ? 'bg-[#C8102E] border-[#C8102E] text-white' : 'bg-white border-gray-300 text-gray-400'}`}>
                      {done ? <CheckCircle className="w-5 h-5" /> : s.icon}
                    </div>
                    <span className={`mt-1 text-xs font-medium ${active ? 'text-[#C8102E]' : done ? 'text-green-600' : 'text-gray-400'}`}>
                      {s.label}
                    </span>
                  </div>
                  {i < STEPS.length - 1 && (
                    <div className={`h-0.5 flex-1 mx-1 mb-5 rounded ${i < stepIndex ? 'bg-green-400' : 'bg-gray-200'}`} />
                  )}
                </div>
              )
            })}
          </div>

          {error && (
            <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
              {error}
            </div>
          )}

          {/* ── STEP 1: Amount ──────────────────────────────────────── */}
          {step === 'amount' && (
            <div>
              <h2 className="text-xl font-semibold text-[#0A2342] mb-6">
                {lang === 'zh' ? '选择捐赠金额' : 'Choose Your Donation Amount'}
              </h2>
              <div className="grid grid-cols-2 gap-3 mb-6">
                {SUGGESTED_AMOUNTS.map(a => (
                  <button key={a} type="button"
                    onClick={() => { setAmount(String(a)); setCustomAmount('') }}
                    className={`py-4 rounded-xl border-2 font-bold text-lg transition-colors
                      ${amount === String(a) ? 'border-[#C8102E] bg-red-50 text-[#C8102E]' : 'border-gray-200 text-gray-600 hover:border-gray-300'}`}>
                    ${a}
                  </button>
                ))}
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {lang === 'zh' ? '或输入自定义金额' : 'Or enter a custom amount'}
                </label>
                <div className="relative">
                  <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400 font-semibold">$</span>
                  <input
                    type="number"
                    min="1"
                    step="1"
                    value={customAmount}
                    onChange={e => { setCustomAmount(e.target.value); setAmount('') }}
                    placeholder="0"
                    className="w-full pl-8 pr-4 py-3 border border-gray-300 rounded-xl text-lg font-semibold focus:outline-none focus:ring-2 focus:ring-[#C8102E]"
                  />
                </div>
              </div>

              {/* Donor info */}
              <div className="mt-6 space-y-4">
                <h3 className="font-semibold text-gray-700">
                  {lang === 'zh' ? '捐赠人信息' : 'Donor Information'}
                </h3>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      {lang === 'zh' ? '名' : 'First Name'} <span className="text-red-500">*</span>
                    </label>
                    <input required value={payForm.firstName}
                      onChange={e => setPayForm(p => ({ ...p, firstName: e.target.value }))}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#C8102E]" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      {lang === 'zh' ? '姓' : 'Last Name'} <span className="text-red-500">*</span>
                    </label>
                    <input required value={payForm.lastName}
                      onChange={e => setPayForm(p => ({ ...p, lastName: e.target.value }))}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#C8102E]" />
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    {lang === 'zh' ? '电子邮件' : 'Email'} <span className="text-red-500">*</span>
                  </label>
                  <input type="email" required value={payForm.email}
                    onChange={e => setPayForm(p => ({ ...p, email: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#C8102E]" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    {lang === 'zh' ? '电话（可选）' : 'Phone (optional)'}
                  </label>
                  <input type="tel" value={payForm.phone}
                    onChange={e => setPayForm(p => ({ ...p, phone: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#C8102E]" />
                </div>
              </div>

              <button
                onClick={() => { if (donateAmount > 0) nextStep() }}
                disabled={donateAmount <= 0 || !payForm.firstName || !payForm.lastName || !payForm.email}
                className="mt-8 w-full bg-[#C8102E] text-white py-3 rounded-xl font-semibold hover:bg-[#a00d25] transition-colors disabled:opacity-50">
                {lang === 'zh' ? `继续 · $${donateAmount}` : `Continue · $${donateAmount}`}
              </button>
            </div>
          )}

          {/* ── STEP 2: Payment (QR + declaration) ─────────────────── */}
          {step === 'payment' && (
            <form onSubmit={handlePaymentSubmit}>
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
                  <p className="text-xs text-amber-600 mt-3">
                    {lang === 'zh' ? '（当前为测试模式 — 不会产生真实扣款）' : '(Test mode — no real charge will be made)'}
                  </p>
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
          )}

          {/* ── STEP 3: Proof Upload ───────────────────────────────── */}
          {step === 'proof' && (
            <form onSubmit={handleProofUpload}>
              <h2 className="text-xl font-semibold text-[#0A2342] mb-2">
                {lang === 'zh' ? '上传付款截图' : 'Upload Payment Screenshot'}
              </h2>
              <p className="text-sm text-gray-500 mb-2">
                {lang === 'zh'
                  ? '请上传付款成功截图，帮助我们确认您的捐赠。'
                  : 'Please upload a screenshot of your completed payment to help us confirm your donation.'}
              </p>
              {eventId && (
                <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-lg text-xs text-blue-700">
                  {lang === 'zh' ? '参考号：' : 'Reference #: '}<strong>{eventId}</strong>
                </div>
              )}

              <div
                className="border-2 border-dashed border-gray-300 rounded-xl p-8 text-center cursor-pointer hover:border-[#C8102E] transition-colors"
                onClick={() => fileRef.current?.click()}
                onDragOver={e => e.preventDefault()}
                onDrop={e => {
                  e.preventDefault()
                  const f = e.dataTransfer.files[0]
                  if (f) setProofFile(f)
                }}>
                <Upload className="w-10 h-10 text-gray-400 mx-auto mb-3" />
                {proofFile ? (
                  <p className="text-sm font-medium text-[#0A2342]">{proofFile.name}</p>
                ) : (
                  <>
                    <p className="text-sm font-medium text-gray-700">
                      {lang === 'zh' ? '点击或拖拽上传截图' : 'Click or drag & drop your screenshot'}
                    </p>
                    <p className="text-xs text-gray-400 mt-1">PNG, JPG, HEIC up to 10 MB</p>
                  </>
                )}
                <input ref={fileRef} type="file" accept="image/*,.heic" className="hidden"
                  onChange={e => { if (e.target.files?.[0]) setProofFile(e.target.files[0]) }} />
              </div>

              <div className="flex gap-4 mt-8">
                <button type="button" onClick={nextStep}
                  className="flex-1 border border-gray-300 text-gray-500 py-3 rounded-xl text-sm hover:bg-gray-50 transition-colors">
                  {lang === 'zh' ? '跳过（稍后上传）' : 'Skip for now'}
                </button>
                <button type="submit" disabled={!proofFile || submitting}
                  className="flex-1 bg-[#C8102E] text-white py-3 rounded-xl font-semibold hover:bg-[#a00d25] transition-colors disabled:opacity-50 flex items-center justify-center gap-2">
                  {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
                  {submitting ? (lang === 'zh' ? '上传中…' : 'Uploading…') : (lang === 'zh' ? '提交截图' : 'Submit Screenshot →')}
                </button>
              </div>
            </form>
          )}

          {/* ── STEP 4: Done ──────────────────────────────────────── */}
          {step === 'done' && (
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
          )}
        </div>
      </div>
    </main>
  )
}
