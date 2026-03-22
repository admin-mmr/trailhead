'use client'

import { useState, Suspense }         from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { Mountain, Lock, Eye, EyeOff, Loader2, CheckCircle2, XCircle } from 'lucide-react'

function ResetPasswordContent() {
  const params  = useSearchParams()
  const router  = useRouter()
  const token   = params.get('token') ?? ''

  const [password,  setPassword]  = useState('')
  const [confirm,   setConfirm]   = useState('')
  const [showPass,  setShowPass]  = useState(false)
  const [loading,   setLoading]   = useState(false)
  const [done,      setDone]      = useState(false)
  const [error,     setError]     = useState('')

  if (!token) {
    return (
      <div className="text-center space-y-4">
        <XCircle className="mx-auto h-12 w-12 text-red-400" />
        <h2 className="text-xl font-bold text-gray-800">Invalid link</h2>
        <p className="text-gray-500 text-sm">
          This reset link is missing a token. Please request a new one.
        </p>
        <a href="/auth/forgot-password" className="text-brand-orange hover:underline text-sm">
          Request new link →
        </a>
      </div>
    )
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (password !== confirm) { setError('Passwords do not match.'); return }
    if (password.length < 8)  { setError('Password must be at least 8 characters.'); return }
    setLoading(true)
    try {
      const res  = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password }),
      })
      const data = await res.json()
      if (!data.ok) { setError(data.error); return }
      setDone(true)
      setTimeout(() => router.push('/login'), 3000)
    } catch {
      setError('Something went wrong. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  if (done) {
    return (
      <div className="text-center space-y-4">
        <CheckCircle2 className="mx-auto h-12 w-12 text-green-500" />
        <h2 className="text-xl font-bold text-gray-800">Password updated!</h2>
        <p className="text-gray-500 text-sm">
          Your password has been reset. Redirecting to login…
        </p>
        <p className="text-gray-400 text-xs">密码已成功重置，正在跳转至登录页面。</p>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div>
        <h2 className="text-xl font-bold text-gray-800 mb-1">Set new password</h2>
        <p className="text-sm text-gray-400">设置新密码</p>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1.5">New password</label>
        <div className="relative">
          <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <input
            type={showPass ? 'text' : 'password'}
            value={password}
            onChange={e => setPassword(e.target.value)}
            placeholder="Min. 8 characters"
            className="input-field pl-10 pr-10"
            required
            minLength={8}
            autoComplete="new-password"
            autoFocus
          />
          <button
            type="button"
            onClick={() => setShowPass(v => !v)}
            className="absolute right-3.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
            tabIndex={-1}
          >
            {showPass ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1.5">Confirm password</label>
        <div className="relative">
          <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <input
            type={showPass ? 'text' : 'password'}
            value={confirm}
            onChange={e => setConfirm(e.target.value)}
            placeholder="Re-enter password"
            className="input-field pl-10"
            required
            autoComplete="new-password"
          />
        </div>
      </div>

      {/* Password strength hint */}
      <ul className="text-xs text-gray-400 space-y-0.5 pl-4 list-disc">
        <li className={password.length >= 8 ? 'text-green-500' : ''}>At least 8 characters</li>
        <li className={/[A-Z]/.test(password) ? 'text-green-500' : ''}>One uppercase letter</li>
        <li className={/[0-9]/.test(password) ? 'text-green-500' : ''}>One number</li>
      </ul>

      {error && (
        <p className="text-red-500 text-sm bg-red-50 rounded-lg px-3 py-2">{error}</p>
      )}

      <button
        type="submit"
        disabled={loading || password.length < 8 || password !== confirm}
        className="btn-primary w-full flex items-center justify-center gap-2 disabled:opacity-50"
      >
        {loading && <Loader2 className="h-4 w-4 animate-spin" />}
        Reset password
      </button>
    </form>
  )
}

export default function ResetPasswordPage() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-brand-navy to-brand-navy-dark flex items-center justify-center p-4">
      <div className="relative w-full max-w-md">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-brand-orange rounded-2xl mb-4 shadow-lg">
            <Mountain className="h-8 w-8 text-white" />
          </div>
          <h1 className="text-white font-bold text-2xl">Misty Mountain Runners</h1>
          <p className="text-white/60 text-sm mt-1">岚山跑团</p>
        </div>
        <div className="bg-white rounded-3xl shadow-2xl p-8 animate-fade-in">
          <Suspense>
            <ResetPasswordContent />
          </Suspense>
        </div>
      </div>
    </div>
  )
}
