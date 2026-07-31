// ============================================================
// lib/is-webview.ts — embedded-browser detection
//
// Google BLOCKS OAuth inside embedded webviews (it returns
// `disallowed_useragent`), so a member who opens our link from
// inside a chat app cannot use "Continue with Google" at all.
// The login page uses this to show the "open in a browser"
// warning BEFORE they tap a social button and hit Google's
// dead end.
//
// ⚠️ WeChat is the club's main sharing channel — `MicroMessenger`
// MUST stay in this list. Android WeChat looks like ordinary
// Chrome (`... Chrome/107 Mobile Safari/537.36 ... MicroMessenger/8`)
// with NO `; wv)` token, so the generic Android-webview heuristic
// below does not catch it. iOS WeChat is caught either way (no
// `Safari` token), which is why this bug only ever showed up on
// Android.
//
// Client-safe: no imports, no server-only values — the login page
// is a client component.
// ============================================================

/**
 * Apps whose in-app browser is an embedded webview. Matched
 * case-insensitively against the UA string.
 *
 * MicroMessenger / Weixin → WeChat      QQ / MQQBrowser  → QQ
 * FBAN / FBAV / FB_IAB    → Facebook    Instagram        → Instagram
 * Weibo                   → Weibo       DingTalk         → DingTalk
 * AlipayClient            → Alipay      Line / KAKAOTALK → Line / KakaoTalk
 */
const IN_APP_BROWSERS = [
  'micromessenger', 'weixin', 'wxwork',
  'qq/', 'mqqbrowser',
  'weibo',
  'dingtalk',
  'alipayclient',
  'fban', 'fbav', 'fb_iab',
  'instagram',
  'line/',
  'kakaotalk',
  'snapchat',
  'twitter',
  'tiktok', 'bytedance', 'bytelocale',
  'electron',
] as const

/**
 * True when `ua` looks like an embedded webview rather than a real browser.
 *
 * Deliberately errs toward false positives: the consequence of a wrong
 * `true` is an extra "open in a browser" hint next to buttons that still
 * work, while a wrong `false` sends the member into a Google error page
 * with no explanation.
 */
export function isWebViewUA(ua: string | undefined | null): boolean {
  if (!ua) return false
  const s = ua.toLowerCase()

  // Named in-app browsers — the reliable signal.
  if (IN_APP_BROWSERS.some(marker => s.includes(marker))) return true

  // Generic Android webview: Chrome sets `; wv)` in the platform section.
  if (s.includes('android') && /;\s*wv\)/.test(s)) return true

  // Android apps embedding WebView without the wv token still omit the
  // browser brand entirely, e.g. `... AppleWebKit/537.36 (KHTML, like Gecko)
  // Version/4.0 Mobile Safari/537.36`, where real Chrome would add `Chrome/`.
  if (s.includes('android') && s.includes('version/') && !s.includes('chrome/')) return true

  // iOS: every real browser (Safari, Chrome/CriOS, Firefox/FxiOS, Edge/EdgiOS)
  // carries a `Safari` token; WKWebView-hosted pages do not.
  if (/iphone|ipad|ipod/.test(s) && !s.includes('safari')) return true

  return false
}

/** Reads the current browser's UA. Returns false during SSR. */
export function isWebViewBrowser(): boolean {
  if (typeof navigator === 'undefined') return false
  return isWebViewUA(navigator.userAgent)
}
