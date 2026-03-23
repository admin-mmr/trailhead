'use client'

// ============================================================
// /auth/setup-password
//
// For existing MMR members who have never set a password in
// the new portal.  Their member record already exists in the
// database (synced from Google Sheets); they just need to
// create a password for the first time.
//
// Reuses the same /api/auth/forgot-password endpoint so they
// receive the same secure one-time reset link by email.
// ============================================================

import { useState }  from 'react'
import { Mountain, Mail, ArrowLeft, Loader2, CheckCircle2 } from 'lucide-react'

export default function SetupPasswordPage() {
  const [email,     setEmail]     = useState('')
  const [loading,   setLoading]   = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [error,     setError]     = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const res  = await fetch('/api/auth/forgot-password', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ email }),
      })
      const data = await res.json()
      if (!data.ok) { setError(data.error ?? 'Something went wrong.'); return }
      setSubmitted(true)
    } catch {
      setError('Something went wrong. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-brand-navy to-brand-navy-dark flex items-center justify-center p-4">
      <div className="relative w-full max-w-md">

        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-brand-orange rounded-2xl mb-4 shadow-lg">
            <Mountain className="h-8 w-8 text-white" />
          </div>
          <h1 className="text-white font-bold text-2xl">Misty Mountain Runners</h1>
          <p className="text-white/60 text-sm mt-1">岚山跑团</p>
        </div>

        <div className="bg-white rounded-3xl shadow-2xl p-8 animate-fade-in">
          {submitted ? (

            /* ── Success state ──────────────────────────────────────────── */
            <div className="text-center space-y-4">
              <CheckCircle2 className="mx-auto h-12 w-12 text-green-500" />
              <h2 className="text-xl font-bold text-gray-800">Check your inbox</h2>
              <p className="text-gray-600 text-sm">
                If <strong>{email}</strong> is in our member records, we sent you a
                password-setup link. It expires in <strong>60 minutes</strong>.
              </p>
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-left text-sm text-amber-800 space-y-2">
                <p>
                  <strong>Don't see the email?</strong>
                </p>
                <ul className="list-disc list-inside space-y-1 text-xs text-amber-700">
                  <li>Check your <strong>spam / junk</strong> folder — our emails sometimes land there.</li>
                  <li>Make sure you entered the same email address you used when you joined MMR.</li>
                  <li>
                    Still nothing? Write to{' '}
                    <a href="mailto:web@mmrunners.org" className="underline font-medium">
                      web@mmrunners.org
                    </a>{' '}
                    and we&apos;ll help you get in.
                  </li>
                </ul>
              </div>
              <p className="text-gray-400 text-xs">
                如未收到邮件，请检查垃圾邮件文件夹，或发送邮件至 web@mmrunners.org 联系我们。
              </p>
              <a
                href="/login"
                className="inline-flex items-center gap-1.5 text-sm text-brand-orange hover:underline"
              >
                <ArrowLeft className="h-3.5 w-3.5" /> Back to login
              </a>
            </div>

          ) : (

            /* ── Request form ───────────────────────────────────────────── */
            <form onSubmit={handleSubmit} className="space-y-5">
              <div>
                <h2 className="text-xl font-bold text-gray-800 mb-1">Set up your portal password</h2>
                <p className="text-sm text-gray-400">首次设置密码 · 现有会员专用</p>
              </div>

              <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 text-sm text-blue-800">
                <p>
                  <strong>Already an MMR member?</strong> Your profile is already in our system.
                  Enter your member email below and we&apos;ll send you a one-time link to create
                  your portal password.
                </p>
                <p className="mt-2 text-xs text-blue-600">
                  这是现有会员首次设置密码入口。如果您已有密码，请直接
                  <a href="/login" className="underline ml-1">登录</a>。
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">
                  Your member email address
                </label>
                <div className="relative">
                  <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                  <input
                    type="email"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    placeholder="you@example.com"
                    className="input-field pl-10"
                    required
                    autoFocus
                    autoComplete="email"
                  />
                </div>
                <p className="text-xs text-gray-400 mt-1">
                  Use the email address on file with MMR (the one we have from when you joined).
                </p>
              </div>

              {error && (
                <p className="text-red-500 text-sm bg-red-50 rounded-lg px-3 py-2">{error}</p>
              )}

              <button
                type="submit"
                disabled={loading}
                className="btn-primary w-full flex items-center justify-center gap-2"
              >
                {loading && <Loader2 className="h-4 w-4 animate-spin" />}
                Send me a setup link
              </button>

              <div className="flex flex-col items-center gap-2 text-xs text-gray-400">
                <a
                  href="/login"
                  className="flex items-center gap-1 hover:text-brand-navy transition-colors"
                >
                  <ArrowLeft className="h-3 w-3" /> Back to login
                </a>
                <a href="/auth/forgot-password" className="hover:text-brand-navy transition-colors">
                  Already have a password? Reset it →
                </a>
              </div>
            </form>
          )}
        </div>

        {/* New member? */}
        <p className="text-center text-white/50 text-xs mt-6">
          New to MMR?{' '}
          <a href="/join" className="text-brand-gold hover:text-brand-gold-light underline">
            Join here →
          </a>
        </p>
      </div>
    </div>
  )
}
