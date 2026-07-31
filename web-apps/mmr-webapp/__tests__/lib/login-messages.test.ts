/**
 * Login error copy.
 *
 * These strings are the only explanation a locked-out member gets, and two of
 * them point at causes a member cannot possibly guess: `oauth_no_member` (the
 * Google address is not the one on file) and `Configuration` (our own server
 * misconfiguration). Both must say what to do next, in both languages.
 */

import { loginErrorMessage } from '@/app/login/_components/messages'

describe('loginErrorMessage', () => {
  it('is empty when there is no error param', () => {
    expect(loginErrorMessage(null, 'en')).toBe('')
    expect(loginErrorMessage(null, 'zh')).toBe('')
  })

  it.each(['CredentialsSignin', 'oauth_failed', 'oauth_no_member', 'Configuration', 'SomethingNew'])(
    'returns copy in both languages for %s',
    code => {
      const en = loginErrorMessage(code, 'en')
      const zh = loginErrorMessage(code, 'zh')
      expect(en).not.toBe('')
      expect(zh).not.toBe('')
      expect(zh).not.toBe(en)
      // Chinese copy must actually be Chinese, not an untranslated fallback.
      expect(zh).toMatch(/[一-鿿]/)
    },
  )

  it('falls back to a generic message for an unrecognised code', () => {
    expect(loginErrorMessage('WhoKnows', 'en')).toMatch(/sign-in failed/i)
  })

  describe('oauth_no_member — the address is simply not on file', () => {
    it('names the mismatch rather than implying the account is broken', () => {
      const en = loginErrorMessage('oauth_no_member', 'en')
      expect(en).toMatch(/not on our member list/i)
      expect(en).toMatch(/email you registered with/i)
    })

    it('offers both escape routes: password reset and a human', () => {
      const en = loginErrorMessage('oauth_no_member', 'en')
      const zh = loginErrorMessage('oauth_no_member', 'zh')
      expect(en).toMatch(/forgot password/i)
      expect(en).toContain('admin@mmrunners.org')
      expect(zh).toContain('忘记密码')
      expect(zh).toContain('admin@mmrunners.org')
    })

    it('is distinct from oauth_failed — different cause, different fix', () => {
      expect(loginErrorMessage('oauth_no_member', 'en'))
        .not.toBe(loginErrorMessage('oauth_failed', 'en'))
    })
  })
})
