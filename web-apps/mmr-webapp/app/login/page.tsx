'use client'

import { useState, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Mountain, Mail, Key, ArrowRight, Loader2 } from 'lucide-react'
import { useLang } from '@/lib/i18n/context'

type Step = 'email' | 'otp'

function LoginContent() {
  const { T, lang } = useLang()
  const router      = useRouter()
  const params      = useSearchParams()
  const returnTo    = params.get('from') ?? '/portal'

  const [step,    setStep]    = useState<Step>('email')
  const [email,   setEmail]   = useState('')
  const [code,    setCode]    = useState('')
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState('')

  async function handleSend(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const res  = await fetch('/api/auth/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      })
      const data = await res.json()
      if (!data.ok) { setError(data.error); return }
      setStep('otp')
    } catch {
      setError(T('common.error'))
    } finally {
      setLoading(false)
    }
  }

  async function handleVerify(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const res  = await fetch('/api/auth/verify-otp', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, code }),
      })
      const data = await res.json()
      if (!data.ok) { setError(data.error); return }
      router.push(data.redirect ?? returnTo)
    } catch {
      setError(T('common.error'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-brand-navy to-brand-navy-dark flex items-center justify-center p-4">
      {/* Background orbs */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="orb orb-1 absolute w-96 h-96 bg-brand-orange -top-20 -right-20" />
        <div className="orb orb-2 absolute w-80 h-80 bg-brand-navy-light bottom-0 left-0" />
      </div>

      <div className="relative w-full max-w-md">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-brand-orange rounded-2xl mb-4 shadow-lg">
            <Mountain className="h-8 w-8 text-white" />
          </div>
          <h1 className="text-white font-bold text-2xl">
            {lang === 'zh' ? '岚山跑团' : 'Misty Mountain Runners'}
          </h1>
          <p className="text-white/60 text-sm mt-1">
            {lang === 'zh' ? '会员登录' : 'Member Login'}
          </p>
        </div>

        {/* Card */}
        <div className="bg-white rounded-3xl shadow-2xl p-8 animate-fade-in">
          {step === 'email' ? (
            <form onSubmit={handleSend} className="space-y-5">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">
                  {T('auth.email.label')}
                </label>
                <div className="relative">
                  <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                  <input
                    type="email"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    placeholder={T('auth.email.ph')}
                    className="input-field pl-10"
                    required
                    autoFocus
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
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
                {T('auth.send')}
              </button>

              <p className="text-center text-xs text-gray-400">
                {lang === 'zh'
                  ? '我们会发送一次性验证码到您的邮箱，无需设置密码。'
                  : 'We\'ll send a one-time code to your email — no password needed.'}
              </p>
            </form>
          ) : (
            <form onSubmit={handleVerify} className="space-y-5">
              <div>
                <p className="text-sm text-gray-500 mb-4">
                  {lang === 'zh'
                    ? `验证码已发送至 ${email}`
                    : `Code sent to ${email}`}
                </p>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">
                  {T('auth.otp.label')}
                </label>
                <div className="relative">
                  <Key className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                  <input
                    type="text"
                    inputMode="numeric"
                    pattern="\d{6}"
                    maxLength={6}
                    value={code}
                    onChange={e => setCode(e.target.value.replace(/\D/g, ''))}
                    placeholder={T('auth.otp.ph')}
                    className="input-field pl-10 text-center text-2xl tracking-[0.5em] font-mono"
                    required
                    autoFocus
                  />
                </div>
              </div>

              {error && (
                <p className="text-red-500 text-sm bg-red-50 rounded-lg px-3 py-2">{error}</p>
              )}

              <button
                type="submit"
                disabled={loading || code.length !== 6}
                className="btn-primary w-full flex items-center justify-center gap-2 disabled:opacity-50"
              >
                {loading && <Loader2 className="h-4 w-4 animate-spin" />}
                {T('auth.verify')}
              </button>

              <button
                type="button"
                onClick={() => { setStep('email'); setCode(''); setError('') }}
                className="w-full text-sm text-gray-400 hover:text-brand-navy transition-colors"
              >
                ← {T('auth.resend')}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginContent />
    </Suspense>
  )
}
