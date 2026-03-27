'use client'

import { useState, useRef, useEffect } from 'react'
import { useLang } from '@/lib/i18n/context'
import { t } from '@/lib/i18n/translations'
import Image from 'next/image'
import { CheckCircle, Upload, CreditCard, User, ClipboardList } from 'lucide-react'
import type { Member } from '@/types'

// ── Types ──────────────────────────────────────────────────────────────────
type Plan = 'individual' | 'family' | 'family_upgrade'
type Step = 'plan' | 'info' | 'payment' | 'proof' | 'done'

interface MemberInfo {
  firstName: string
  lastName: string
  email: string
  phone: string
  wechatId: string
  district: string
  gender: string
  yearBorn: string
  nyrrRunnerName: string
}

const PLANS: Record<Plan, { label: string; labelZh: string; amount: number; desc: string; descZh: string }> = {
  individual: {
    label: 'Individual Membership',
    labelZh: '个人会员',
    amount: 30,
    desc: 'One runner, full club access',
    descZh: '单人跑者，完整俱乐部访问权限',
  },
  family: {
    label: 'Family Membership',
    labelZh: '家庭会员',
    amount: 50,
    desc: 'Up to 4 family members at one address',
    descZh: '同住家庭最多4名成员',
  },
  family_upgrade: {
    label: 'Family Upgrade',
    labelZh: '升级家庭会员',
    amount: 20,
    desc: 'Upgrade existing Individual to Family',
    descZh: '将现有个人会员升级为家庭会员',
  },
}

const STEPS: { id: Step; label: string; icon: React.ReactNode }[] = [
  { id: 'plan', label: 'Plan', icon: <ClipboardList className="w-4 h-4" /> },
  { id: 'info', label: 'Info', icon: <User className="w-4 h-4" /> },
  { id: 'payment', label: 'Pay', icon: <CreditCard className="w-4 h-4" /> },
  { id: 'proof', label: 'Proof', icon: <Upload className="w-4 h-4" /> },
  { id: 'done', label: 'Done', icon: <CheckCircle className="w-4 h-4" /> },
]

const STEP_ORDER: Step[] = ['plan', 'info', 'payment', 'proof', 'done']

// ── Component ──────────────────────────────────────────────────────────────
export default function JoinPage() {
  const { lang } = useLang()
  const [step, setStep] = useState<Step>('plan')
  const [plan, setPlan] = useState<Plan>('individual')
  const [payMethod, setPayMethod] = useState<'zelle' | 'venmo'>('zelle')
  const [info, setInfo] = useState<MemberInfo>({
    firstName: '', lastName: '', email: '', phone: '',
    wechatId: '', district: '', gender: '', yearBorn: '', nyrrRunnerName: '',
  })
  const [payForm, setPayForm] = useState({ payerName: '', paymentDate: '', memoField: '', last4: '' })
  const [eventId, setEventId] = useState<string | null>(null)
  const [proofFile, setProofFile] = useState<File | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  // Existing member data (pre-filled when renewing)
  const [existingMember, setExistingMember] = useState<Member | null>(null)

  // On mount: silently check if the user is already logged in.
  // If yes, pre-fill the info form with data from the members table.
  useEffect(() => {
    fetch('/api/members/me')
      .then(r => r.ok ? r.json() : null)
      .then(({ ok, data } = {}) => {
        if (ok && data) {
          setExistingMember(data)
          // Pre-fill the info form — member can review/edit before continuing
          setInfo({
            firstName:      data.firstName      ?? '',
            lastName:       data.lastName       ?? '',
            email:          data.email          ?? '',
            phone:          data.phone          ?? '',
            wechatId:       data.wechatId       ?? '',
            district:       data.district       ?? '',
            gender:         data.gender         ?? '',
            yearBorn:       data.yearBorn != null ? String(data.yearBorn) : '',
            nyrrRunnerName: data.nyrrRunnerName  ?? '',
          })
        }
      })
      .catch(() => { /* not logged in — no-op */ })
  }, [])

  const zelleHandle = process.env.NEXT_PUBLIC_ZELLE_HANDLE ?? 'runningmmr@gmail.com'
  const venmoHandle = process.env.NEXT_PUBLIC_VENMO_HANDLE ?? '@MMRunners'
  const currentPlan = PLANS[plan]
  const stepIndex = STEP_ORDER.indexOf(step)

  // ── Helpers ──────────────────────────────────────────────────────────────
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

  // ── Step 2: Submit member info + payment declaration → /api/payments/submit
  async function handlePaymentSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    setError('')
    try {
      const res = await fetch('/api/payments/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          plan,
          amount: currentPlan.amount,
          paymentMethod: payMethod,
          ...info,
          yearBorn: info.yearBorn ? Number(info.yearBorn) : undefined,
          ...payForm,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Submission failed')
      setEventId(data.eventId)
      nextStep()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setSubmitting(false)
    }
  }

  // ── Step 4: Upload proof screenshot → /api/payments/proof
  async function handleProofUpload(e: React.FormEvent) {
    e.preventDefault()
    if (!proofFile || !eventId) return
    setSubmitting(true)
    setError('')
    try {
      const fd = new FormData()
      fd.append('proof', proofFile)
      fd.append('eventId', eventId)
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

  // ── Progress Bar ──────────────────────────────────────────────────────────
  function ProgressBar() {
    return (
      <div className="flex items-center justify-between mb-10">
        {STEPS.map((s, i) => {
          const done = i < stepIndex
          const active = s.id === step
          return (
            <div key={s.id} className="flex items-center flex-1">
              <div className={`flex flex-col items-center ${i < STEPS.length - 1 ? 'flex-1' : ''}`}>
                <div className={`w-9 h-9 rounded-full flex items-center justify-center text-sm font-semibold border-2 transition-colors
                  ${done ? 'bg-green-500 border-green-500 text-white' : active ? 'bg-[#0A2342] border-[#0A2342] text-white' : 'bg-white border-gray-300 text-gray-400'}`}>
                  {done ? <CheckCircle className="w-5 h-5" /> : s.icon}
                </div>
                <span className={`mt-1 text-xs font-medium ${active ? 'text-[#0A2342]' : done ? 'text-green-600' : 'text-gray-400'}`}>
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
    )
  }

  // ── Render ────────────────────────────────────────────────────────────────
  const isRenewing = !!existingMember

  return (
    <main className="min-h-screen bg-gray-50 py-12">
      <div className="max-w-2xl mx-auto px-4">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-[#0A2342]">
            {isRenewing
              ? (lang === 'zh' ? '续费会员' : 'Renew Your Membership')
              : (lang === 'zh' ? '加入我们' : 'Join Misty Mountain Runners')}
          </h1>
          <p className="text-gray-500 mt-2">
            {lang === 'zh' ? '成为我们社区的一员' : 'Become part of our running community'}
          </p>
        </div>

        {/* Renewing-as banner */}
        {isRenewing && existingMember && (
          <div className="mb-6 p-4 bg-blue-50 border border-blue-200 rounded-xl flex items-center gap-3">
            <div className="w-9 h-9 rounded-full bg-[#0A2342] flex items-center justify-center text-white font-bold flex-shrink-0">
              {([existingMember.firstName, existingMember.lastName].filter(Boolean).join(' ') || existingMember.email)[0].toUpperCase()}
            </div>
            <div>
              <p className="text-sm font-semibold text-[#0A2342]">
                {lang === 'zh' ? '续费身份：' : 'Renewing as:'}{' '}
                {[existingMember.firstName, existingMember.lastName].filter(Boolean).join(' ') || existingMember.email}
              </p>
              <p className="text-xs text-gray-500">
                {lang === 'zh' ? '会员编号：' : 'Member ID: '}{existingMember.memberId}
                {' · '}{existingMember.email}
              </p>
            </div>
          </div>
        )}

        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8">
          <ProgressBar />

          {error && (
            <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
              {error}
            </div>
          )}

          {/* ── STEP 1: Plan Selection ─────────────────────────────── */}
          {step === 'plan' && (
            <div>
              <h2 className="text-xl font-semibold text-[#0A2342] mb-6">
                {lang === 'zh' ? '选择会员套餐' : 'Choose Your Membership Plan'}
              </h2>
              <div className="grid gap-4">
                {(Object.entries(PLANS) as [Plan, typeof PLANS[Plan]][]).map(([key, p]) => (
                  <label key={key}
                    className={`flex items-start gap-4 p-4 border-2 rounded-xl cursor-pointer transition-colors
                      ${plan === key ? 'border-[#F47B20] bg-orange-50' : 'border-gray-200 hover:border-gray-300'}`}>
                    <input type="radio" name="plan" value={key} checked={plan === key}
                      onChange={() => setPlan(key)} className="mt-1" />
                    <div className="flex-1">
                      <div className="flex justify-between items-center">
                        <span className="font-semibold text-[#0A2342]">
                          {lang === 'zh' ? p.labelZh : p.label}
                        </span>
                        <span className="text-xl font-bold text-[#F47B20]">${p.amount}</span>
                      </div>
                      <p className="text-sm text-gray-500 mt-1">
                        {lang === 'zh' ? p.descZh : p.desc}
                      </p>
                    </div>
                  </label>
                ))}
              </div>
              <button onClick={nextStep}
                className="mt-8 w-full bg-[#0A2342] text-white py-3 rounded-xl font-semibold hover:bg-[#0d2d55] transition-colors">
                {lang === 'zh' ? '继续' : 'Continue →'}
              </button>
            </div>
          )}

          {/* ── STEP 2: Member Info ────────────────────────────────── */}
          {step === 'info' && (
            <form onSubmit={(e) => { e.preventDefault(); nextStep() }}>
              <h2 className="text-xl font-semibold text-[#0A2342] mb-2">
                {isRenewing
                  ? (lang === 'zh' ? '确认个人信息' : 'Review Your Info')
                  : (lang === 'zh' ? '填写个人信息' : 'Your Information')}
              </h2>
              {isRenewing && (
                <p className="text-sm text-gray-500 mb-6">
                  {lang === 'zh'
                    ? '我们已从您的会员档案中预填了以下信息，请确认或更新后继续。'
                    : 'We pre-filled your info from your member record. Review and update if needed.'}
                </p>
              )}
              <div className="grid grid-cols-2 gap-4">
                {/* Text fields */}
                {([
                  { key: 'firstName',     label: 'First Name',         labelZh: '名',          required: true },
                  { key: 'lastName',      label: 'Last Name',          labelZh: '姓',          required: true },
                  { key: 'email',         label: 'Email Address',      labelZh: '电子邮件',    required: true, type: 'email', colSpan: true },
                  { key: 'phone',         label: 'Phone',              labelZh: '电话',        required: true, type: 'tel' },
                  { key: 'wechatId',      label: 'WeChat ID',          labelZh: '微信号' },
                  { key: 'district',      label: 'District / Borough', labelZh: '地区',        colSpan: true },
                  { key: 'yearBorn',      label: 'Year of Birth',      labelZh: '出生年份',    type: 'number' },
                  { key: 'nyrrRunnerName',label: 'NYRR Runner Name',   labelZh: 'NYRR 姓名' },
                ] as { key: keyof MemberInfo; label: string; labelZh: string; required?: boolean; type?: string; colSpan?: boolean }[]).map(f => (
                  <div key={f.key} className={f.colSpan ? 'col-span-2' : ''}>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      {lang === 'zh' ? f.labelZh : f.label}
                      {f.required && <span className="text-red-500 ml-1">*</span>}
                    </label>
                    <input
                      type={f.type ?? 'text'}
                      required={f.required}
                      value={info[f.key]}
                      onChange={e => setInfo(prev => ({ ...prev, [f.key]: e.target.value }))}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#0A2342]"
                    />
                    {f.key === 'yearBorn' && (
                      <p className="text-xs text-gray-400 mt-1">
                        {lang === 'zh'
                          ? '用于通过大致年龄匹配 NYRR 跑者信息。'
                          : 'Used to match your NYRR runner profile by approximate age.'}
                      </p>
                    )}
                  </div>
                ))}

                {/* Gender — select */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    {lang === 'zh' ? '性别' : 'Gender'}
                  </label>
                  <select
                    value={info.gender}
                    onChange={e => setInfo(prev => ({ ...prev, gender: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#0A2342]"
                  >
                    <option value="">{lang === 'zh' ? '请选择' : 'Select…'}</option>
                    <option value="Male">{lang === 'zh' ? '男' : 'Male'}</option>
                    <option value="Female">{lang === 'zh' ? '女' : 'Female'}</option>
                    <option value="Non-binary">{lang === 'zh' ? '非二元' : 'Non-binary'}</option>
                    <option value="Prefer not to say">{lang === 'zh' ? '不透露' : 'Prefer not to say'}</option>
                  </select>
                </div>
              </div>

              <div className="flex gap-4 mt-8">
                <button type="button" onClick={prevStep}
                  className="flex-1 border border-gray-300 text-gray-700 py-3 rounded-xl font-semibold hover:bg-gray-50 transition-colors">
                  {lang === 'zh' ? '返回' : '← Back'}
                </button>
                <button type="submit"
                  className="flex-1 bg-[#0A2342] text-white py-3 rounded-xl font-semibold hover:bg-[#0d2d55] transition-colors">
                  {lang === 'zh' ? '继续' : 'Continue →'}
                </button>
              </div>
            </form>
          )}

          {/* ── STEP 3: Payment (Zelle / Venmo QR) ────────────────── */}
          {step === 'payment' && (
            <form onSubmit={handlePaymentSubmit}>
              <h2 className="text-xl font-semibold text-[#0A2342] mb-2">
                {lang === 'zh' ? '付款方式' : 'Complete Your Payment'}
              </h2>
              <p className="text-sm text-gray-500 mb-6">
                {lang === 'zh'
                  ? `请支付 $${currentPlan.amount}，选择 Zelle 或 Venmo。`
                  : `Please send $${currentPlan.amount} via Zelle or Venmo.`}
              </p>

              {/* Method toggle */}
              <div className="flex gap-3 mb-6">
                {(['zelle', 'venmo'] as const).map(m => (
                  <button key={m} type="button"
                    onClick={() => setPayMethod(m)}
                    className={`flex-1 py-2 rounded-xl border-2 font-semibold capitalize transition-colors
                      ${payMethod === m ? 'border-[#F47B20] bg-orange-50 text-[#F47B20]' : 'border-gray-200 text-gray-500 hover:border-gray-300'}`}>
                    {m.charAt(0).toUpperCase() + m.slice(1)}
                  </button>
                ))}
              </div>

              {/* QR + instructions */}
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
                      ? `备注请填写: ${info.firstName} ${info.lastName} ${lang === 'zh' ? currentPlan.labelZh : currentPlan.label}`
                      : `Memo: ${info.firstName} ${info.lastName} – ${currentPlan.label}`}
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
                    placeholder={lang === 'zh' ? '您在付款时输入的备注' : 'e.g. John Smith Individual Membership'}
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

              <div className="flex gap-4 mt-8">
                <button type="button" onClick={prevStep}
                  className="flex-1 border border-gray-300 text-gray-700 py-3 rounded-xl font-semibold hover:bg-gray-50 transition-colors">
                  {lang === 'zh' ? '返回' : '← Back'}
                </button>
                <button type="submit" disabled={submitting}
                  className="flex-1 bg-[#0A2342] text-white py-3 rounded-xl font-semibold hover:bg-[#0d2d55] transition-colors disabled:opacity-50">
                  {submitting ? (lang === 'zh' ? '提交中…' : 'Submitting…') : (lang === 'zh' ? '提交付款信息' : 'Submit Payment Info →')}
                </button>
              </div>
            </form>
          )}

          {/* ── STEP 4: Proof Upload ───────────────────────────────── */}
          {step === 'proof' && (
            <form onSubmit={handleProofUpload}>
              <h2 className="text-xl font-semibold text-[#0A2342] mb-2">
                {lang === 'zh' ? '上传付款截图' : 'Upload Payment Screenshot'}
              </h2>
              <p className="text-sm text-gray-500 mb-2">
                {lang === 'zh'
                  ? '请上传 Zelle 或 Venmo 的付款成功截图，帮助我们更快完成审核。'
                  : 'Please upload a screenshot of your completed Zelle or Venmo payment to help us verify faster.'}
              </p>
              {eventId && (
                <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-lg text-xs text-blue-700">
                  {lang === 'zh' ? '参考号：' : 'Reference #: '}<strong>{eventId}</strong>
                  {' — '}{lang === 'zh' ? '请保存此号码' : 'Save this for your records'}
                </div>
              )}

              <div
                className="border-2 border-dashed border-gray-300 rounded-xl p-8 text-center cursor-pointer hover:border-[#F47B20] transition-colors"
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
                  className="flex-1 bg-[#0A2342] text-white py-3 rounded-xl font-semibold hover:bg-[#0d2d55] transition-colors disabled:opacity-50">
                  {submitting ? (lang === 'zh' ? '上传中…' : 'Uploading…') : (lang === 'zh' ? '提交截图' : 'Submit Screenshot →')}
                </button>
              </div>
            </form>
          )}

          {/* ── STEP 5: Done ──────────────────────────────────────── */}
          {step === 'done' && (
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
              {eventId && (
                <div className="inline-block bg-gray-50 border border-gray-200 rounded-xl px-6 py-3 mb-6">
                  <p className="text-xs text-gray-500 uppercase tracking-wider">
                    {lang === 'zh' ? '参考号' : 'Reference Number'}
                  </p>
                  <p className="text-lg font-mono font-bold text-[#0A2342] mt-1">{eventId}</p>
                </div>
              )}
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
          )}
        </div>
      </div>
    </main>
  )
}
