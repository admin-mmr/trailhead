import { Loader2 } from 'lucide-react'
import type { Lang } from '@/lib/i18n/translations'
import { PROVIDERS } from './shared'

// ── In-app browser warning ───────────────────────────────────────────────────
// Google BLOCKS OAuth inside embedded webviews, so this must appear BEFORE the
// member taps a provider button. WeChat is the club's main sharing channel —
// see lib/is-webview.ts for why Android WeChat is easy to miss.
export function WebViewWarning({ lang }: { lang: Lang }) {
  return (
    <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-sm text-amber-800">
      <p className="font-semibold">
        ⚠️ {lang === 'zh' ? '请在浏览器中打开' : 'Open in a browser'}
      </p>
      <p className="mt-1 text-xs text-amber-700">
        {lang === 'zh'
          ? 'Google / Microsoft 登录在应用内浏览器（微信、QQ 等）中被禁用。请点右上角「⋯」→「在浏览器中打开」，或复制链接后在 Chrome / Safari 中打开；也可以直接用下方的邮箱密码登录。'
          : 'Google / Microsoft sign-in is blocked inside in-app browsers (WeChat, QQ, Instagram, etc.). Open this page in Chrome or Safari — or just use the email + password form below.'}
      </p>
    </div>
  )
}

// ── Stalled hand-off notice ──────────────────────────────────────────────────
// The provider redirect never committed. Offers the route a member with no
// password can actually take, rather than leaving a spinner running forever.
function StallNotice({ lang, onDismiss }: { lang: Lang; onDismiss: () => void }) {
  return (
    <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-sm text-amber-800">
      <p className="font-semibold">
        {lang === 'zh' ? '正在等待登录服务商…' : 'Still waiting for the provider…'}
      </p>
      <p className="mt-1 text-xs text-amber-700">
        {lang === 'zh'
          ? 'Google / Microsoft 在部分网络（包括中国大陆）无法访问。请改用下方的邮箱密码登录；若尚未设置密码，请点击「忘记密码」。'
          : 'Google / Microsoft are unreachable on some networks (including mainland China). Use the email + password form below instead — if you have never set a password, use "Forgot password".'}
      </p>
      <button
        type="button"
        onClick={onDismiss}
        className="mt-2 text-xs font-semibold text-amber-900 underline"
      >
        {lang === 'zh' ? '取消' : 'Cancel'}
      </button>
    </div>
  )
}

// ── Provider buttons ─────────────────────────────────────────────────────────

interface SocialSignInProps {
  lang:         Lang
  oauthLoading: string | null
  oauthStalled: boolean
  onSignIn:     (providerId: string) => void
  onDismiss:    () => void
}

export function SocialSignIn({ lang, oauthLoading, oauthStalled, onSignIn, onDismiss }: SocialSignInProps) {
  return (
    <div className="space-y-2.5">
      {PROVIDERS.map(({ id, label, Icon, bg, text }) => (
        <button
          key={id}
          type="button"
          onClick={() => onSignIn(id)}
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

      {oauthStalled && <StallNotice lang={lang} onDismiss={onDismiss} />}
    </div>
  )
}
