'use client'

import { useState, useRef, useEffect, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { Upload, CheckCircle, ArrowLeft, Loader2 } from 'lucide-react'

// ─────────────────────────────────────────────────────────────────────────────
// Standalone payment-proof upload page
//
// Accessible to any logged-in member (pending, expired, or active) — this page
// intentionally lives OUTSIDE /portal so that pending members who are redirected
// to /membership/inactive can still reach it without hitting the active-only gate.
//
// If no ?eventId= query param is provided this page auto-fetches the member's
// most recent pending payment event via GET /api/payments/pending.
// ─────────────────────────────────────────────────────────────────────────────

interface PendingEvent {
  event_id:       string
  payment_intent: string
  amount:         number
  payment_method: string
  created_at:     string
  proof_url:      string | null
}

function PaymentProofContent() {
  const searchParams = useSearchParams()
  const paramEventId = searchParams.get('eventId') ?? ''

  const [eventId,     setEventId]     = useState(paramEventId)
  const [loadingEvent, setLoadingEvent] = useState(!paramEventId)
  const [proofFile,   setProofFile]   = useState<File | null>(null)
  const [submitting,  setSubmitting]  = useState(false)
  const [done,        setDone]        = useState(false)
  const [error,       setError]       = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  // Auto-fetch the member's most recent pending event when no eventId in URL
  useEffect(() => {
    if (paramEventId || !loadingEvent) return
    fetch('/api/payments/pending')
      .then(r => r.json())
      .then((data: { events?: PendingEvent[] }) => {
        const latest = data.events?.[0]
        if (latest) setEventId(latest.event_id)
      })
      .catch(() => {/* no-op — user can still try to upload */})
      .finally(() => setLoadingEvent(false))
  }, [paramEventId, loadingEvent])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!proofFile || !eventId) return
    setSubmitting(true)
    setError('')
    try {
      const fd = new FormData()
      fd.append('proof',   proofFile)
      fd.append('eventId', eventId)
      const res  = await fetch('/api/payments/proof', { method: 'POST', body: fd })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Upload failed')
      setDone(true)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Upload failed')
    } finally {
      setSubmitting(false)
    }
  }

  if (done) {
    return (
      <div className="text-center py-12">
        <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
          <CheckCircle className="w-9 h-9 text-green-500" />
        </div>
        <h2 className="text-2xl font-bold text-[#0A2342] mb-2">Screenshot Uploaded!</h2>
        <p className="text-gray-600 mb-2">
          We&apos;ll review your payment and activate your membership within 1–2 business days.
        </p>
        <p className="text-gray-400 text-sm mb-6">
          我们将尽快完成审核并激活您的会员资格。
        </p>
        <Link
          href="/membership/inactive"
          className="inline-block bg-[#0A2342] text-white px-8 py-3 rounded-xl font-semibold hover:bg-[#0d2d55] transition-colors"
        >
          Back to Membership Status
        </Link>
      </div>
    )
  }

  if (loadingEvent) {
    return (
      <div className="flex items-center justify-center py-16 text-gray-400">
        <Loader2 className="w-6 h-6 animate-spin mr-2" />
        <span className="text-sm">Loading your payment info…</span>
      </div>
    )
  }

  return (
    <div>
      <Link
        href="/membership/inactive"
        className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-700 mb-6"
      >
        <ArrowLeft className="w-4 h-4" />
        Back to Membership Status
      </Link>

      <h1 className="text-2xl font-bold text-[#0A2342] mb-1">Upload Payment Screenshot</h1>
      <p className="text-gray-400 text-sm mb-1">上传付款截图</p>
      <p className="text-gray-500 text-sm mb-2">
        Please upload your Zelle or Venmo payment confirmation screenshot.
      </p>
      <p className="text-gray-400 text-sm mb-6">
        请上传您的 Zelle 或 Venmo 付款成功截图。
      </p>

      {eventId && (
        <p className="text-xs text-gray-400 mb-6">
          Reference: <span className="font-mono font-semibold text-gray-600">{eventId}</span>
        </p>
      )}

      {!eventId && (
        <div className="mb-6 p-4 bg-amber-50 border border-amber-200 rounded-lg text-amber-800 text-sm">
          No pending payment found. If you just submitted a payment, please wait a moment and refresh.
          If the issue persists, contact us at{' '}
          <a href="mailto:info@mountainmadnessrunners.com" className="underline">
            info@mountainmadnessrunners.com
          </a>
          .
        </div>
      )}

      {error && (
        <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit}>
        <div
          className="border-2 border-dashed border-gray-300 rounded-xl p-10 text-center cursor-pointer hover:border-[#F47B20] transition-colors"
          onClick={() => fileRef.current?.click()}
          onDragOver={e => e.preventDefault()}
          onDrop={e => {
            e.preventDefault()
            const f = e.dataTransfer.files[0]
            if (f) setProofFile(f)
          }}
        >
          <Upload className="w-12 h-12 text-gray-400 mx-auto mb-3" />
          {proofFile ? (
            <p className="text-sm font-medium text-[#0A2342]">{proofFile.name}</p>
          ) : (
            <>
              <p className="text-sm font-medium text-gray-700">
                Click or drag &amp; drop your screenshot
              </p>
              <p className="text-xs text-gray-400 mt-1">PNG, JPG, HEIC up to 10 MB</p>
            </>
          )}
          <input
            ref={fileRef}
            type="file"
            accept="image/*,.heic"
            className="hidden"
            onChange={e => { if (e.target.files?.[0]) setProofFile(e.target.files[0]) }}
          />
        </div>

        <button
          type="submit"
          disabled={!proofFile || !eventId || submitting}
          className="mt-6 w-full bg-[#0A2342] text-white py-3 rounded-xl font-semibold
                     hover:bg-[#0d2d55] transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
        >
          {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
          {submitting ? 'Uploading…' : 'Submit Screenshot / 提交截图'}
        </button>
      </form>
    </div>
  )
}

export default function PaymentProofPage() {
  return (
    <main className="min-h-screen bg-gray-50 py-12">
      <div className="max-w-lg mx-auto px-4">
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8">
          <Suspense fallback={
            <div className="flex items-center justify-center py-16 text-gray-400">
              <Loader2 className="w-6 h-6 animate-spin mr-2" />
              <span className="text-sm">Loading…</span>
            </div>
          }>
            <PaymentProofContent />
          </Suspense>
        </div>
      </div>
    </main>
  )
}
