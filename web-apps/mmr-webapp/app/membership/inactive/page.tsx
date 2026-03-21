'use client'

// ============================================================
// /membership/inactive
//
// Shown when a logged-in member tries to access an 'active'-tier
// route but their membership status is 'inactive' or 'pending'.
//
// Query params (injected by middleware):
//   ?status=inactive|pending
//   ?from=<original pathname>   (used for post-refresh redirect)
// ============================================================

import { useSearchParams, useRouter } from 'next/navigation'
import { Suspense, useState }          from 'react'
import Link                            from 'next/link'

// ── Inner component (reads searchParams) ────────────────────
function InactiveContent() {
  const params   = useSearchParams()
  const router   = useRouter()
  const status   = params.get('status') ?? 'inactive'
  const from     = params.get('from')   ?? '/portal'
  const isPending = status === 'pending'

  const [checking, setChecking] = useState(false)
  const [error,    setError]    = useState<string | null>(null)

  // Re-fetch the member's current status from the DB and issue a fresh JWT.
  // Used after renewal so the middleware sees the updated status.
  async function handleCheckStatus() {
    setChecking(true)
    setError(null)
    try {
      const res = await fetch('/api/auth/refresh-session', { method: 'POST' })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.error ?? 'Could not refresh your session. Please try again.')
        return
      }
      const data = await res.json()
      if (data.status === 'active') {
        router.push(from)
      } else {
        setError(
          data.status === 'pending'
            ? 'Your payment is still being reviewed. We'll activate your membership within 1–2 business days.'
            : 'Your membership is still inactive. Please renew to regain access.'
        )
      }
    } catch {
      setError('Network error. Please try again.')
    } finally {
      setChecking(false)
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
      <div className="max-w-md w-full">

        {/* Card */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">

          {/* Header stripe */}
          <div
            className={`px-8 py-6 ${
              isPending ? 'bg-amber-500' : 'bg-[#1F497D]'
            }`}
          >
            <div className="text-white text-center">
              <div className="text-4xl mb-2">{isPending ? '⏳' : '🔒'}</div>
              <h1 className="text-xl font-bold">
                {isPending ? 'Membership Pending' : 'Membership Inactive'}
              </h1>
              <p className="text-sm opacity-80 mt-1">Misty Mountain Runners · 岚山跑团</p>
            </div>
          </div>

          {/* Body */}
          <div className="px-8 py-6">
            {isPending ? (
              <>
                <p className="text-gray-700 mb-4">
                  Your application is <strong>under review</strong>. Our team will verify your
                  payment and activate your membership within <strong>1–2 business days</strong>.
                </p>
                <p className="text-gray-600 text-sm mb-6">
                  Once activated you'll have full access to the member portal, photo service, race
                  results, and club events. You'll receive a confirmation email when your membership
                  goes live.
                </p>
                <p className="text-gray-500 text-sm mb-6">
                  您的申请正在审核中，我们将在 1–2 个工作日内激活您的会员资格并发送确认邮件。
                </p>

                {/* Upload proof CTA */}
                <Link
                  href="/portal/payment-proof"
                  className="block w-full text-center bg-amber-500 hover:bg-amber-600 text-white
                             font-semibold py-3 px-6 rounded-full transition-colors mb-3"
                >
                  Upload Payment Screenshot →
                </Link>
              </>
            ) : (
              <>
                <p className="text-gray-700 mb-4">
                  Your membership has <strong>expired</strong>. Renew now to regain access to the
                  member portal, club photos, race results, and all member benefits.
                </p>
                <p className="text-gray-500 text-sm mb-6">
                  您的会员资格已过期。请续费以继续享受岚山跑团的所有会员权益。
                </p>

                {/* Renew CTA */}
                <Link
                  href="/join"
                  className="block w-full text-center bg-[#E86033] hover:bg-[#d4552c] text-white
                             font-semibold py-3 px-6 rounded-full transition-colors mb-3"
                >
                  Renew My Membership →
                </Link>
              </>
            )}

            {/* Check / refresh status button */}
            <button
              onClick={handleCheckStatus}
              disabled={checking}
              className="w-full border border-gray-300 hover:border-gray-400 text-gray-700
                         font-medium py-2.5 px-6 rounded-full transition-colors disabled:opacity-50
                         disabled:cursor-not-allowed text-sm"
            >
              {checking ? 'Checking…' : 'I already renewed — check my status'}
            </button>

            {error && (
              <p className="mt-3 text-sm text-red-600 text-center">{error}</p>
            )}
          </div>

          {/* Footer */}
          <div className="px-8 py-4 bg-gray-50 border-t border-gray-100 text-center">
            <p className="text-xs text-gray-500">
              Questions?{' '}
              <a
                href="mailto:info@mistymountainrunners.org"
                className="text-[#1F497D] hover:underline"
              >
                info@mistymountainrunners.org
              </a>
            </p>
          </div>
        </div>

        {/* Back link */}
        <p className="mt-4 text-center text-sm text-gray-500">
          <Link href="/" className="hover:text-gray-700 transition-colors">
            ← Back to home
          </Link>
        </p>

      </div>
    </div>
  )
}

// ── Page (wraps in Suspense for useSearchParams) ─────────────
export default function MembershipInactivePage() {
  return (
    <Suspense>
      <InactiveContent />
    </Suspense>
  )
}
