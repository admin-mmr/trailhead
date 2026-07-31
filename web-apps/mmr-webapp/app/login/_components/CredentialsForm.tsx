import { Mail, Lock, Eye, EyeOff, Loader2 } from 'lucide-react'
import type { Lang } from '@/lib/i18n/translations'

interface CredentialsFormProps {
  lang:        Lang
  email:       string
  setEmail:    (v: string) => void
  password:    string
  setPassword: (v: string) => void
  showPass:    boolean
  setShowPass: (fn: (v: boolean) => boolean) => void
  loading:     boolean
  error:       string
  onSubmit:    (e: React.FormEvent) => void
}

// Email + password sign-in. Also carries the error slot, because every error on
// this page (OAuth included) resolves to "try the password form instead".
export function CredentialsForm({
  lang, email, setEmail, password, setPassword,
  showPass, setShowPass, loading, error, onSubmit,
}: CredentialsFormProps) {
  return (
    <form onSubmit={onSubmit} className="space-y-4">
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

      <div className="text-center space-y-1">
        <a
          href="/auth/forgot-password"
          className="block text-xs text-brand-orange hover:underline"
        >
          {lang === 'zh' ? '忘记密码？' : 'Forgot password?'}
        </a>
        <a
          href="/auth/setup-password"
          className="block text-xs text-gray-400 hover:text-brand-navy transition-colors"
        >
          {lang === 'zh' ? '首次登录？点此设置密码 →' : 'First time here? Set up your portal password →'}
        </a>
      </div>
    </form>
  )
}
