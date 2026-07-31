import { isWebViewUA } from '@/lib/is-webview'

// Real UA strings. The Android WeChat case is the regression this file exists
// for: it carries `Chrome/` and `Safari/` and no `; wv)`, so it looked like an
// ordinary browser to the old inline check and members got no warning before
// Google rejected them with `disallowed_useragent`.
const WEBVIEWS: Record<string, string> = {
  'WeChat Android': 'Mozilla/5.0 (Linux; Android 13; SM-S918B Build/TP1A.220624.014; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/107.0.5304.141 Mobile Safari/537.36 MMWEBID/1234 MicroMessenger/8.0.32.2300(0x28002037) WeChat/arm64 Weixin NetType/WIFI Language/zh_CN',
  'WeChat Android (no wv token)': 'Mozilla/5.0 (Linux; Android 12; Redmi Note 11) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/107.0.0.0 Mobile Safari/537.36 MicroMessenger/8.0.30.2300(0x28001E37) Process/tools WeChat/arm64 Weixin NetType/4G',
  'WeChat iOS': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 MicroMessenger/8.0.42(0x18002a2b) NetType/WIFI Language/zh_CN',
  'WeCom / WeChat Work': 'Mozilla/5.0 (Linux; Android 13; PGT-AN10) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/110.0.0.0 Mobile Safari/537.36 wxwork/4.1.6 MicroMessenger/7.0.1',
  'QQ Android': 'Mozilla/5.0 (Linux; Android 12; V2049A) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/91.0.4472.114 Mobile Safari/537.36 V1_AND_SQ_8.9.10_2860_YYB_D QQ/8.9.10.9145 NetType/WIFI',
  'Weibo iOS': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Weibo (iPhone14,3__weibo__13.7.0__iphone__os16.6)',
  'DingTalk': 'Mozilla/5.0 (Linux; U; Android 12; zh-CN; NOH-AN00) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/100.0.4896.58 Mobile Safari/537.36 AliApp(DingTalk/6.5.50) com.alibaba.android.rimet/26178691',
  'Alipay': 'Mozilla/5.0 (Linux; Android 13; 22041216C) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/103.0.5060.129 Mobile Safari/537.36 AliApp(AP/10.3.60.8000) AlipayClient/10.3.60.8000',
  'Facebook iOS': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBDV/iPhone14,3;FBMD/iPhone]',
  'Instagram': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 302.1.0.999',
  'Generic Android WebView': 'Mozilla/5.0 (Linux; Android 11; Pixel 4 Build/RQ3A.210805.001.A1; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/92.0.4515.159 Mobile Safari/537.36',
  'Android WebView (no Chrome brand)': 'Mozilla/5.0 (Linux; Android 10; ANE-LX1) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Mobile Safari/537.36',
  'iOS WKWebView': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148',
}

const REAL_BROWSERS: Record<string, string> = {
  'Chrome Android': 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Mobile Safari/537.36',
  'Safari iOS': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Mobile/15E148 Safari/604.1',
  'Chrome iOS': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/119.0.6045.109 Mobile/15E148 Safari/604.1',
  'Firefox iOS': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/120.0 Mobile/15E148 Safari/605.1.15',
  'Edge iOS': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 EdgiOS/119.0.2151.44 Mobile/15E148 Safari/604.1',
  'Chrome macOS': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
  'Safari macOS': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Safari/605.1.15',
  'Firefox Windows': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:120.0) Gecko/20100101 Firefox/120.0',
  'Edge Windows': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36 Edg/119.0.2109.67',
}

describe('isWebViewUA', () => {
  it.each(Object.entries(WEBVIEWS))('flags %s as a webview', (_name, ua) => {
    expect(isWebViewUA(ua)).toBe(true)
  })

  it.each(Object.entries(REAL_BROWSERS))('does not flag %s', (_name, ua) => {
    expect(isWebViewUA(ua)).toBe(false)
  })

  it('is case-insensitive', () => {
    expect(isWebViewUA('SomeApp MICROMESSENGER/8.0.0')).toBe(true)
  })

  it('returns false for a missing UA rather than throwing', () => {
    expect(isWebViewUA(undefined)).toBe(false)
    expect(isWebViewUA(null)).toBe(false)
    expect(isWebViewUA('')).toBe(false)
  })

  it('does not match "qq" inside an unrelated word', () => {
    // Guards the `qq/` marker against false hits like a device model "AQQ100".
    expect(isWebViewUA('Mozilla/5.0 (Linux; Android 13; AQQ100) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Mobile Safari/537.36')).toBe(false)
  })
})
