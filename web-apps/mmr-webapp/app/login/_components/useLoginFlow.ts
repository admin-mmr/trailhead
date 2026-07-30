import { useState, useEffect, useRef } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { signIn } from 'next-auth/react'
import { useLang } from '@/lib/i18n/context'
import { isWebViewBrowser } from '@/lib/is-webview'
import { OAUTH_STALL_MS } from './shared'
import {
  loginErrorMessage,
  credentialsFailedMessage,
  unexpectedErrorMessage,
  providerUnreachableMessage,
} from './messages'

// All state, effects and sign-in handlers for /login.
// Kept separate from the view so page.tsx stays a thin orchestrator.
export function useLoginFlow() {
  const { lang } = useLang()
  const router   = useRouter()
  const params   = useSearchParams()

  const returnTo  = params.get('from') ?? '/portal'
  const urlError  = params.get('error')
  const isGoodbye = params.get('goodbye') === '1'

  const [email,        setEmail]        = useState('')
  const [password,     setPassword]     = useState('')
  const [showPass,     setShowPass]     = useState(false)
  const [loading,      setLoading]      = useState(false)
  const [oauthLoading, setOauthLoading] = useState<string | null>(null)
  const [oauthStalled, setOauthStalled] = useState(false)
  const [isWebView,    setIsWebView]    = useState(false)

  // `null` = nothing set by a handler yet, so the ?error= copy shows through.
  //
  // ⚠️ Do NOT seed this with loginErrorMessage() in a useState initializer —
  // that runs once, on the first render, when `lang` is still the 'en' default
  // (LanguageProvider reads localStorage in an effect AFTER mount). A member
  // whose preference is 中文 would get the buttons in Chinese and the error in
  // English, permanently. Deriving it each render keeps the copy in step with
  // the language while still letting a handler override or clear it.
  const [error, setError] = useState<string | null>(null)
  const shownError = error ?? loginErrorMessage(urlError, lang)

  const stallTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useEffect(() => {
    setIsWebView(isWebViewBrowser())
    return () => clearTimeout(stallTimer.current)
  }, [])

  // ── Email + password sign-in ───────────────────────────────────────────────
  async function handleCredentials(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const result = await signIn('credentials', { email, password, redirect: false })
      console.log('[login] signIn("credentials") result:', result)
      if (result?.error) {
        console.log('[login] credentials error:', result.error)
        setError(credentialsFailedMessage(lang))
      } else {
        const target = `/auth/complete?from=${encodeURIComponent(returnTo)}`
        console.log('[login] credentials OK — pushing to:', target)
        router.push(target)
      }
    } catch (err) {
      console.error('[login] signIn threw:', err)
      setError(unexpectedErrorMessage(lang))
    } finally {
      setLoading(false)
    }
  }

  // ── OAuth sign-in ─────────────────────────────────────────────────────────
  //
  // signIn() POSTs to /api/auth/signin/<provider>, then hands the browser to
  // the provider with window.location.href. The promise never resolves on the
  // happy path — this page is being torn down by that navigation.
  //
  // ⚠️ It can also never resolve on the SAD path: if accounts.google.com is
  // unreachable (blocked network, or a WeChat/QQ webview refusing the hop) the
  // navigation just stalls, and nothing here would ever clear the spinner —
  // members reported "spinning forever with no timeout". So we arm a watchdog
  // that offers the email + password fallback if we're still alive after a few
  // seconds, and we catch errors from the POST itself.
  async function handleOAuth(providerId: string) {
    setError('')
    setOauthStalled(false)
    setOauthLoading(providerId)

    // Still on this page after OAUTH_STALL_MS ⇒ the hand-off did not happen.
    // Not cleared on success: the navigation unmounts us first.
    stallTimer.current = setTimeout(() => setOauthStalled(true), OAUTH_STALL_MS)

    try {
      await signIn(providerId, { callbackUrl: '/auth/complete' })
    } catch (err) {
      console.error('[login] OAuth signIn threw:', err)
      clearTimeout(stallTimer.current)
      setOauthLoading(null)
      setError(providerUnreachableMessage(lang))
    }
  }

  function dismissStall() {
    setOauthStalled(false)
    setOauthLoading(null)
  }

  return {
    lang, isGoodbye, isWebView,
    email, setEmail,
    password, setPassword,
    showPass, setShowPass,
    loading, error: shownError,
    oauthLoading, oauthStalled,
    handleCredentials, handleOAuth, dismissStall,
  }
}
