'use client'

import { useState, Suspense }    from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { signIn }                 from 'next-auth/react'
import { Mountain, Mail, Lock, Eye, EyeOff, Loader2 } from 'lucide-react'
import { useLang }                from '@/lib/i18n/context'

// ── Provider icon SVGs (inline, no extra deps) ────────────────────────────────

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden="true">
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/>
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
    </svg>
  )
}

function AppleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor" aria-hidden="true">
      <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.8-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z"/>
    </svg>
  )
}

function MicrosoftIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden="true">
      <path fill="#f25022" d="M1 1h10v10H1z"/>
      <path fill="#00a4ef" d="M13 1h10v10H13z"/>
      <path fill="#7fba00" d="M1 13h10v10H1z"/>
      <path fill="#ffb900" d="M13 13h10v10H13z"/>
    </svg>
  )
}

function FacebookIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="#1877F2" aria-hidden="true">
      <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/>
    </svg>
  )
}

function YahooIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="#6001D2" aria-hidden="true">
      <path d="M0 0l6.6 14.4L0 24h4.2l3.9-6 3.9 6H16l-6.6-9.6L16 0H0zm14.4 0l4.2 9 4.2-9H14.4zM18.6 15l-4.2 9h3.9L24 15h-5.4z"/>
    </svg>
  )
}

// ── OAuth provider config ──────────────────────────────────────────────────────

const PROVIDERS = [
  { id: 'google',              label: 'Google',    Icon: GoogleIcon,    bg: 'bg-white border border-gray-200 hover:bg-gray-50', text: 'text-gray-700' },
  { id: 'apple',               label: 'Apple',     Icon: AppleIcon,     bg: 'bg-black hover:bg-gray-900',                       text: 'text-white'    },
  { id: 'microsoft-entra-id',  label: 'Microsoft', Icon: MicrosoftIcon, bg: 'bg-white border border-gray-200 hover:bg-gray-50', text: 'text-gray-700' },
  { id: 'facebook',            label: 'Facebook',  Icon: FacebookIcon,  bg: 'bg-[#1877F2] hover:bg-[#166FE5]',                  text: 'text-white'    },
  { id: 'yahoo',               label: 'Yahoo',     Icon: YahooIcon,     bg: 'bg-white border border-gray-200 hover:bg-gray-50', text: 'text-gray-700' },
] as const

// ── Login form ────────────────────────────────────────────────────────────────

function LoginContent() {
  const { lang }  = useLang()
  const router    = useRouter()
  const params    = useSearchParams()
  const returnTo  = params.get('from') ?? '/portal'
  const urlError  = params.get('error')

  const [email,       setEmail]       = useState('')
  const [password,    setPassword]    = useState('')
  const [showPass,    setShowPass]    = useState(false)
  const [loading,     setLoading]     = useState(false)
  const [oauthLoading,setOauthLoading]= useState<string | null>(null)
  const [error,       setError]       = useState(
    urlError === 'CredentialsSignin' ? (lang === 'zh' ? '邮箱或密码错误。' : 'Incorrect email or password.') : ''
  )

  // ── Email + password sign-in ───────────────────────────────────────────────
  async function handleCredentials(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const result = await signIn('credentials', {
        email,
        password,
        redirect: false,
      })
      console.log('[login] signIn("credentials") result:', result)
      if (result?.error) {
        console.log('[login] credentials error:', result.error)
        setError(lang === 'zh' ? '邮箱或密码错误。' : 'Incorrect email or password.')
      } else {
        // NextAuth session is set — go to bridge to create mmr_session
        const target = `/auth/complete?from=${encodeURIComponent(returnTo)}`
        console.log('[login] credentials OK — pushing to:', target)
        router.push(target)
      }
    } catch (err) {
      console.error('[login] signIn threw:', err)
      setError(lang === 'zh' ? '出错了，请重试。' : 'Something went wrong. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  // ── OAuth sign-in ─────────────────────────────────────────────────────────
  async function handleOAuth(providerId: string) {
    setOauthLoading(providerId)
    await signIn(providerId, { callbackUrl: '/auth/complete' })
    // signIn redirects — this line won't run unless there's an error
    setOauthLoading(null)
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
        <div className="bg-white rounded-3xl shadow-2xl p-8 animate-fade-in space-y-6">

          {/* ── Social login ──────────────────────────────────────────────── */}
          <div className="space-y-2.5">
            {PROVIDERS.map(({ id, label, Icon, bg, text }) => (
              <button
                key={id}
                type="button"
                onClick={() => handleOAuth(id)}
                disabled={!!oauthLoading}
                className={`w-full flex items-center justify-center gap-3 py-2.5 px-4 rounded-xl font-medium text-sm transition-colors ${bg} ${text} disabled:opacity-60`}
              >
                {oauthLoading === id
                  ? <Loader2 className="h-4 w-4 animate-spin" />
                  : <Icon />
                }
                {lang === 'zh' ? `使用 ${label} 登录` : `Continue with ${label}`}
              </button>
            ))}
          </div>

          {/* ── Divider ───────────────────────────────────────────────────── */}
          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-gray-200" />
            </div>
            <div className="relative flex justify-center text-xs">
              <span className="bg-white px-3 text-gray-400">
                {lang === 'zh' ? '或使用邮箱密码登录' : 'or sign in with email'}
              </span>
            </div>
          </div>

          {/* ── Email + password form ──────────────────────────────────────── */}
          <form onSubmit={handleCredentials} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                {lang === 'zh' ? '邮箱' : 'Email'}
              </label>
              <div className="relative">
                <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                <input
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder={lang === 'zh' ? '您的邮箱地址' : 'you@example.com'}
                  className="input-field pl-10"
                  required
                  autoComplete="email"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                {lang === 'zh' ? '密码' : 'Password'}
              </label>
              <div className="relative">
                <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                <input
                  type={showPass ? 'text' : 'password'}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="input-field pl-10 pr-10"
                  required
                  autoComplete="current-password"
                />
                <button
                  type="button"
                  onClick={() => setShowPass(v => !v)}
                  className="absolute right-3.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                  tabIndex={-1}
                  aria-label={showPass ? 'Hide password' : 'Show password'}
                >
                  {showPass ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
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
              {lang === 'zh' ? '登录' : 'Sign in'}
            </button>

            <div className="text-center">
              <a
                href="/auth/forgot-password"
                className="text-xs text-brand-orange hover:underline"
              >
                {lang === 'zh' ? '忘记密码？' : 'Forgot password?'}
              </a>
            </div>
          </form>

          <p className="text-center text-xs text-gray-400">
            {lang === 'zh'
              ? '还没有账号？请通过会员申请页加入。'
              : "Don't have an account? "}
            {lang !== 'zh' && (
              <a href="/join" className="text-brand-orange hover:underline">Join here →</a>
            )}
          </p>
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
