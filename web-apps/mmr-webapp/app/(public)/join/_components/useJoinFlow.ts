import { useState, useRef, useEffect } from 'react'
import { useLang } from '@/lib/i18n/context'
import type { Member } from '@/types'
import {
  PLANS, STEP_ORDER,
  type Plan, type Step, type MemberInfo, type FieldErrors, type PayForm,
  validateInfoField,
} from './shared'

// All state, effects, and submit handlers for the multi-step join/renew flow.
// Kept separate from the view so page.tsx stays a thin orchestrator.
export function useJoinFlow() {
  const { lang } = useLang()
  const [step, setStep] = useState<Step>('plan')
  const [plan, setPlan] = useState<Plan>('individual')
  const [payMethod, setPayMethod] = useState<'card' | 'zelle' | 'venmo'>('card')
  const [info, setInfo] = useState<MemberInfo>({
    firstName: '', lastName: '', email: '', phone: '',
    wechatId: '', district: '', gender: '', yearBorn: '', nyrrRunnerName: '',
  })
  const [payForm, setPayForm] = useState<PayForm>({ payerName: '', paymentDate: '', memoField: '', last4: '' })
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

  // Card payments run in Stripe test mode until live keys are configured —
  // members must see that clearly (banner rendered in the card box below)
  const [stripeTestMode, setStripeTestMode] = useState(false)
  useEffect(() => {
    fetch('/api/payments/stripe/mode')
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (d) setStripeTestMode(!!d.testMode) })
      .catch(() => {})
  }, [])

  const zelleHandle = process.env.NEXT_PUBLIC_ZELLE_HANDLE ?? 'runningmmr@gmail.com'
  const venmoHandle = process.env.NEXT_PUBLIC_VENMO_HANDLE ?? '@MMRunners'
  const currentPlan = PLANS[plan]
  const stepIndex = STEP_ORDER.indexOf(step)
  const isRenewing = !!existingMember

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

  return {
    lang, step, plan, setPlan, payMethod, setPayMethod, info, payForm, setPayForm,
    eventId, memberId, proofFile, setProofFile, fieldErrors, submitting, error,
    fileRef, existingMember, stripeTestMode, zelleHandle, venmoHandle,
    currentPlan, stepIndex, isRenewing,
    handleInfoChange, handleInfoBlur, nextStep, prevStep,
    handleInfoSubmit, handlePaymentSubmit, handleProofUpload,
  }
}
