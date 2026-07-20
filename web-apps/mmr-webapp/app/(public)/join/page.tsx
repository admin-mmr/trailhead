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

// ── Inline field validation ─────────────────────────────────────────────────
type FieldErrors = Partial<Record<keyof MemberInfo, string>>

function validateInfoField(key: keyof MemberInfo, value: string): string {
  switch (key) {
    case 'firstName':
    case 'lastName':
      if (!value.trim()) return key === 'firstName' ? 'First name is required' : 'Last name is required'
      if (value.trim().length < 2) return 'Must be at least 2 characters'
      return ''
    case 'email':
      if (!value.trim()) return 'Email address is required'
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return 'Enter a valid email address (e.g. jane@example.com)'
      return ''
    case 'phone':
      if (!value) return '' // optional
      if (!/^\+?[\d\s\-().]{7,}$/.test(value)) return 'Enter a valid phone number (at least 7 digits, e.g. 212-555-0100)'
      return ''
    case 'gender':
      if (!value) return 'Please select a gender — this helps us match your NYRR runner profile'
      return ''
    case 'yearBorn': {
      if (!value) return ''
      const n = Number(value)
      if (!Number.isInteger(n) || String(n) !== value.trim()) return 'Enter a 4-digit year (e.g. 1990)'
      if (n < 1900 || n > new Date().getFullYear()) return `Year must be between 1900 and ${new Date().getFullYear()}`
      return ''
    }
    default:
      return ''
  }
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
  const [payMethod, setPayMethod] = useState<'card' | 'zelle' | 'venmo'>('card')
  const [info, setInfo] = useState<MemberInfo>({
    firstName: '', lastName: '', email: '', phone: '',
    wechatId: '', district: '', gender: '', yearBorn: '', nyrrRunnerName: '',
  })
  const [payForm, setPayForm] = useState({ payerName: '', paymentDate: '', memoField: '', last4: '' })
  const [eventId, setEventId] = useState<string | null>(null)
  const [memberId, setMemberId] = useState<string | null>(null)
  const [proofFile, setProofFile] = useState<File | null>(null)
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  function handleInfoChange(key: keyof MemberInfo, value: string) {
    setInfo(prev => ({ ...prev, [key]: value }))
    // Clear error on change so user gets immediate feedback
    if (fieldErrors[key]) setFieldErrors(prev => ({ ...prev, [key]: '' }))
  }

  function handleInfoBlur(key: keyof MemberInfo, value: string) {
    const err = validateInfoField(key, value)
    if (err) setFieldErrors(prev => ({ ...prev, [key]: err }))
  }

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
          if (data.memberId) setMemberId(data.memberId)
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

  // Returning from a canceled Stripe Checkout (?canceled=1)
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('canceled')) {
      setError('Card payment was canceled — you can start again anytime. 银行卡付款已取消，您可以随时重新开始。')
    }
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

  // ── Step 2: Enroll member → /api/members/enroll (assigns MemberID, saves to DB + Sheets)
  async function handleInfoSubmit(e: React.FormEvent) {
    e.preventDefault()
    // Run all field validations before submitting
    const required: (keyof MemberInfo)[] = ['firstName', 'lastName', 'email', 'gender']
    const all: (keyof MemberInfo)[] = [...required, 'phone', 'yearBorn']
    const errors: FieldErrors = {}
    for (const key of all) {
      const err = validateInfoField(key, info[key])
      if (err) errors[key] = err
    }
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors)
      return
    }
    setSubmitting(true)
    setError('')
    try {
      const res = await fetch('/api/members/enroll', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          plan,
          ...info,
          yearBorn: info.yearBorn ? Number(info.yearBorn) : undefined,
        }),
      })
      const ct = res.headers.get('content-type') ?? ''
      if (!ct.includes('application/json')) {
        throw new Error('Server returned an unexpected response. Please try again later.')
      }
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Enrollment failed')
      setMemberId(data.memberId)
      nextStep()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setSubmitting(false)
    }
  }

  // ── Step 3: Submit payment declaration → /api/payments/submit
  async function handlePaymentSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    setError('')
    try {
      const isCard = payMethod === 'card'
      const res = await fetch('/api/payments/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          plan,
          amount: currentPlan.amount,
          paymentMethod: payMethod,
          ...info,
          yearBorn: info.yearBorn ? Number(info.yearBorn) : undefined,
          ...(isCard
            ? {
                payerName:   `${info.firstName} ${info.lastName}`.trim(),
                paymentDate: new Date().toISOString().slice(0, 10),
                memoField:   `${memberId ?? ''} ${currentPlan.label} (Stripe)`.trim(),
              }
            : payForm),
        }),
      })
      const contentType = res.headers.get('content-type') ?? ''
      if (!contentType.includes('application/json')) {
        throw new Error('Server returned an unexpected response. Please try again later.')
      }
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Submission failed')
      if (isCard) {
        // Card path: hand off to Stripe Checkout — webhook confirms payment
        const co = await fetch('/api/payments/stripe/checkout', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ submissionId: data.submissionId, email: info.email }),
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

  // ── Step 4: Upload proof screenshot → /api/payments/proof
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
      const ct = res.headers.get('content-type') ?? ''
      if (!ct.includes('application/json')) {
        throw new Error('Server returned an unexpected response. Please try again later.')
      }
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
            <form onSubmit={handleInfoSubmit}>
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
                {/* First / Last name */}
                {([
                  { key: 'firstName', label: 'First Name', labelZh: '名',       required: true },
                  { key: 'lastName',  label: 'Last Name',  labelZh: '姓',       required: true },
                ] as { key: keyof MemberInfo; label: string; labelZh: string; required?: boolean }[]).map(f => (
                  <div key={f.key}>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      {lang === 'zh' ? f.labelZh : f.label}
                      <span className="text-red-500 ml-1">*</span>
                    </label>
                    <input
                      type="text"
                      value={info[f.key]}
                      onChange={e => handleInfoChange(f.key, e.target.value)}
                      onBlur={e => handleInfoBlur(f.key, e.target.value)}
                      className={`w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#0A2342]
                        ${fieldErrors[f.key] ? 'border-red-400 bg-red-50' : 'border-gray-300'}`}
                    />
                    {fieldErrors[f.key] && (
                      <p className="text-xs text-red-600 mt-1">{fieldErrors[f.key]}</p>
                    )}
                  </div>
                ))}

                {/* Email */}
                <div className="col-span-2">
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    {lang === 'zh' ? '电子邮件' : 'Email Address'}
                    <span className="text-red-500 ml-1">*</span>
                  </label>
                  <input
                    type="email"
                    value={info.email}
                    onChange={e => handleInfoChange('email', e.target.value)}
                    onBlur={e => handleInfoBlur('email', e.target.value)}
                    placeholder="jane@example.com"
                    className={`w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#0A2342]
                      ${fieldErrors.email ? 'border-red-400 bg-red-50' : 'border-gray-300'}`}
                  />
                  {fieldErrors.email && (
                    <p className="text-xs text-red-600 mt-1">{fieldErrors.email}</p>
                  )}
                </div>

                {/* Gender — required, moved up for NYRR matching */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    {lang === 'zh' ? '性别' : 'Gender'}
                    <span className="text-red-500 ml-1">*</span>
                  </label>
                  <select
                    value={info.gender}
                    onChange={e => handleInfoChange('gender', e.target.value)}
                    onBlur={e => handleInfoBlur('gender', e.target.value)}
                    className={`w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#0A2342]
                      ${fieldErrors.gender ? 'border-red-400 bg-red-50' : 'border-gray-300'}`}
                  >
                    <option value="">{lang === 'zh' ? '请选择' : 'Select…'}</option>
                    <option value="Male">{lang === 'zh' ? '男' : 'Male'}</option>
                    <option value="Female">{lang === 'zh' ? '女' : 'Female'}</option>
                    <option value="Non-binary">{lang === 'zh' ? '非二元' : 'Non-binary'}</option>
                    <option value="Prefer not to say">{lang === 'zh' ? '不透露' : 'Prefer not to say'}</option>
                  </select>
                  {fieldErrors.gender
                    ? <p className="text-xs text-red-600 mt-1">{fieldErrors.gender}</p>
                    : <p className="text-xs text-gray-400 mt-1">
                        {lang === 'zh' ? '用于匹配 NYRR 跑者档案。' : 'Helps us match your NYRR runner profile.'}
                      </p>
                  }
                </div>

                {/* Year of Birth */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    {lang === 'zh' ? '出生年份' : 'Year of Birth'}
                  </label>
                  <input
                    type="number"
                    value={info.yearBorn}
                    onChange={e => handleInfoChange('yearBorn', e.target.value)}
                    onBlur={e => handleInfoBlur('yearBorn', e.target.value)}
                    placeholder={lang === 'zh' ? '例如 1990' : 'e.g. 1990'}
                    min={1900}
                    max={new Date().getFullYear()}
                    className={`w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#0A2342]
                      ${fieldErrors.yearBorn ? 'border-red-400 bg-red-50' : 'border-gray-300'}`}
                  />
                  {fieldErrors.yearBorn
                    ? <p className="text-xs text-red-600 mt-1">{fieldErrors.yearBorn}</p>
                    : <p className="text-xs text-gray-400 mt-1">
                        {lang === 'zh' ? '用于通过大致年龄匹配 NYRR 跑者信息。' : 'Used to match your NYRR runner profile by approximate age.'}
                      </p>
                  }
                </div>

                {/* Phone — optional */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    {lang === 'zh' ? '电话' : 'Phone'}
                    <span className="text-gray-400 ml-1 font-normal text-xs">{lang === 'zh' ? '（选填）' : '(optional)'}</span>
                  </label>
                  <input
                    type="tel"
                    value={info.phone}
                    onChange={e => handleInfoChange('phone', e.target.value)}
                    onBlur={e => handleInfoBlur('phone', e.target.value)}
                    placeholder={lang === 'zh' ? '例如 212-555-0100' : 'e.g. 212-555-0100'}
                    className={`w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#0A2342]
                      ${fieldErrors.phone ? 'border-red-400 bg-red-50' : 'border-gray-300'}`}
                  />
                  {fieldErrors.phone && (
                    <p className="text-xs text-red-600 mt-1">{fieldErrors.phone}</p>
                  )}
                </div>

                {/* WeChat ID */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    {lang === 'zh' ? '微信号' : 'WeChat ID'}
                    <span className="text-gray-400 ml-1 font-normal text-xs">{lang === 'zh' ? '（选填）' : '(optional)'}</span>
                  </label>
                  <input
                    type="text"
                    value={info.wechatId}
                    onChange={e => handleInfoChange('wechatId', e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#0A2342]"
                  />
                </div>

                {/* District */}
                <div className="col-span-2">
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    {lang === 'zh' ? '地区' : 'District / Borough'}
                    <span className="text-gray-400 ml-1 font-normal text-xs">{lang === 'zh' ? '（选填）' : '(optional)'}</span>
                  </label>
                  <input
                    type="text"
                    value={info.district}
                    onChange={e => handleInfoChange('district', e.target.value)}
                    placeholder={lang === 'zh' ? '例如 Manhattan, Queens…' : 'e.g. Manhattan, Queens, Brooklyn…'}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#0A2342]"
                  />
                </div>

                {/* NYRR Runner Name */}
                <div className="col-span-2">
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    {lang === 'zh' ? 'NYRR 姓名' : 'NYRR Runner Name'}
                    <span className="text-gray-400 ml-1 font-normal text-xs">{lang === 'zh' ? '（选填）' : '(optional)'}</span>
                  </label>
                  <input
                    type="text"
                    value={info.nyrrRunnerName}
                    onChange={e => handleInfoChange('nyrrRunnerName', e.target.value)}
                    placeholder={lang === 'zh' ? '与 NYRR 账户上完全一致的姓名' : 'Exactly as it appears on your NYRR account'}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#0A2342]"
                  />
                  <p className="text-xs text-gray-400 mt-1">
                    {lang === 'zh'
                      ? '如果与上方姓名不同，请填写您在 NYRR 注册的姓名。'
                      : 'Only needed if different from your name above. Used for race result matching.'}
                  </p>
                </div>
              </div>

              <div className="flex gap-4 mt-8">
                <button type="button" onClick={prevStep}
                  className="flex-1 border border-gray-300 text-gray-700 py-3 rounded-xl font-semibold hover:bg-gray-50 transition-colors">
                  {lang === 'zh' ? '返回' : '← Back'}
                </button>
                <button type="submit" disabled={submitting}
                  className="flex-1 bg-[#0A2342] text-white py-3 rounded-xl font-semibold hover:bg-[#0d2d55] transition-colors disabled:opacity-50">
                  {submitting ? (lang === 'zh' ? '提交中…' : 'Saving…') : (lang === 'zh' ? '继续' : 'Continue →')}
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
          )}
        </div>
      </div>
    </main>
  )
}
