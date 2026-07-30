// Login error copy, keyed by the `?error=` value on /login.
//
// Extracted from a useState initializer so it can be unit-tested: these
// strings are the only explanation a locked-out member gets, and two of them
// (oauth_no_member, Configuration) point at causes the member cannot guess.
//
// NextAuth sends `CredentialsSignin` and `Configuration` itself; the
// `oauth_*` values come from our own /auth/complete bridge.

import type { Lang } from '@/lib/i18n/translations'

export function loginErrorMessage(urlError: string | null, lang: Lang): string {
  if (!urlError) return ''
  const zh = lang === 'zh'

  switch (urlError) {
    case 'CredentialsSignin':
      return zh ? '邮箱或密码错误。' : 'Incorrect email or password.'

    case 'oauth_failed':
      return zh
        ? '社交登录未能获取您的邮箱，请使用邮箱密码登录，或联系管理员。'
        : 'Sign-in did not return an email address. Please use email/password login or contact the admin.'

    // The social account authenticated fine — its address just isn't on file.
    // Naming the likely cause matters: most members registered with an address
    // that is not their Google/Microsoft one.
    case 'oauth_no_member':
      return zh
        ? '该 Google / Microsoft 账号的邮箱不在会员名单中。请使用您注册时填写的邮箱登录（若未设置密码，请点「忘记密码」），或联系 admin@mmrunners.org。'
        : 'That Google / Microsoft account\'s email address is not on our member list. Sign in with the email you registered with — use "Forgot password" if you have never set one — or contact admin@mmrunners.org.'

    case 'Configuration':
      return zh
        ? '登录服务配置错误，请联系管理员。'
        : 'Login service is not configured correctly. Please contact the admin.'

    default:
      return zh ? '登录失败，请重试。' : 'Sign-in failed. Please try again.'
  }
}

export function credentialsFailedMessage(lang: Lang): string {
  return lang === 'zh' ? '邮箱或密码错误。' : 'Incorrect email or password.'
}

export function unexpectedErrorMessage(lang: Lang): string {
  return lang === 'zh' ? '出错了，请重试。' : 'Something went wrong. Please try again.'
}

export function providerUnreachableMessage(lang: Lang): string {
  return lang === 'zh'
    ? '无法连接到登录服务商，请改用下方的邮箱密码登录。'
    : 'Could not reach the sign-in provider. Please use the email + password form below.'
}
