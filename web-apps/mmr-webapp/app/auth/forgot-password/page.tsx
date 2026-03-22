'use client'

import { useState }   from 'react'
import { Mountain, Mail, ArrowLeft, Loader2, CheckCircle2 } from 'lucide-react'

export default function ForgotPasswordPage() {
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
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      })
      const data = await res.json()
      if (!data.ok) { setError(data.error); return }
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
              <p className="text-gray-500 text-sm">
                If <strong>{email}</strong> is registered, we sent a password reset link.
                It expires in 60 minutes.
              </p>
              <p className="text-gray-400 text-xs">
                如果该邮箱已注册，我们已向您发送了密码重置链接，有效期60分钟。
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
                <h2 className="text-xl font-bold text-gray-800 mb-1">Forgot password</h2>
                <p className="text-sm text-gray-400">忘记密码</p>
              </div>

              <p className="text-sm text-gray-500">
                Enter your email address and we&apos;ll send you a link to reset your password.
              </p>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">
                  Email address
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
                Send reset link
              </button>

              <a
                href="/login"
                className="flex items-center justify-center gap-1.5 text-sm text-gray-400 hover:text-brand-navy transition-colors"
              >
                <ArrowLeft className="h-3.5 w-3.5" /> Back to login
              </a>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}
