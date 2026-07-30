'use client'

import { Suspense } from 'react'
import { useLoginFlow } from './_components/useLoginFlow'
import { GoodbyeBanner } from './_components/GoodbyeBanner'
import { SocialSignIn, WebViewWarning } from './_components/SocialSignIn'
import { CredentialsForm } from './_components/CredentialsForm'

// Member login. All state, effects and sign-in handlers live in useLoginFlow();
// this component just wires them to the views.
function LoginContent() {
  const f = useLoginFlow()
  const { lang } = f

  return (
    <div className="min-h-[calc(100vh-4rem)] bg-gradient-to-br from-brand-navy to-brand-navy-dark flex items-center justify-center p-4 relative">
      {f.isGoodbye && <GoodbyeBanner lang={lang} />}

      {/* Background orbs */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="orb orb-1 absolute w-96 h-96 bg-brand-orange -top-20 -right-20" />
        <div className="orb orb-2 absolute w-80 h-80 bg-brand-navy-light bottom-0 left-0" />
      </div>

      <div className="relative w-full max-w-md">
        {/* Logo */}
        <div className="text-center mb-8">
          <h1 className="text-white font-bold text-2xl">
            {lang === 'zh' ? '岚山跑团' : 'Misty Mountain Runners'}
          </h1>
          <p className="text-white/60 text-sm mt-1">
            {lang === 'zh' ? '会员登录' : 'Member Login'}
          </p>
        </div>

        {/* Card */}
        <div className="bg-white rounded-3xl shadow-2xl p-8 animate-fade-in space-y-6">

          {f.isWebView && <WebViewWarning lang={lang} />}

          <SocialSignIn
            lang={lang}
            oauthLoading={f.oauthLoading}
            oauthStalled={f.oauthStalled}
            onSignIn={f.handleOAuth}
            onDismiss={f.dismissStall}
          />

          {/* Divider */}
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

          <CredentialsForm
            lang={lang}
            email={f.email}
            setEmail={f.setEmail}
            password={f.password}
            setPassword={f.setPassword}
            showPass={f.showPass}
            setShowPass={f.setShowPass}
            loading={f.loading}
            error={f.error}
            onSubmit={f.handleCredentials}
          />

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
