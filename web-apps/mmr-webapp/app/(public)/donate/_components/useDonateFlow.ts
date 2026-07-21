import { useState, useRef, useEffect } from 'react'
import { useLang } from '@/lib/i18n/context'
import { STEP_ORDER, type Step, type PayMethod, type DonateForm } from './shared'

// All state, effects, and submit handlers for the multi-step donation flow.
// Kept separate from the view so page.tsx stays a thin orchestrator.
export function useDonateFlow() {
  const { lang } = useLang()
  const [step, setStep] = useState<Step>('amount')
  const [amount, setAmount] = useState<string>('')
  const [customAmount, setCustomAmount] = useState('')
  const [payMethod, setPayMethod] = useState<PayMethod>('card')
  const [payForm, setPayForm] = useState<DonateForm>({
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

  // Card payments run in Stripe test mode until live keys are configured —
  // donors must see that clearly (banner rendered in the card box below)
  const [stripeTestMode, setStripeTestMode] = useState(false)
  useEffect(() => {
    fetch('/api/payments/stripe/mode')
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (d) setStripeTestMode(!!d.testMode) })
      .catch(() => {})
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

  return {
    lang, step, amount, setAmount, customAmount, setCustomAmount,
    payMethod, setPayMethod, payForm, setPayForm, eventId, memberId,
    proofFile, setProofFile, submitting, error, fileRef,
    stripeTestMode, zelleHandle, venmoHandle, stepIndex, donateAmount,
    nextStep, prevStep, handlePaymentSubmit, handleProofUpload,
  }
}
