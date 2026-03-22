/**
 * Tests for lib/i18n/translations.ts
 *
 * Validates every translation key has both 'en' and 'zh' values,
 * and that the t() helper returns the correct string for each language.
 */

import { translations, t, type TranslationKey, type Lang } from '@/lib/i18n/translations'

const allKeys = Object.keys(translations) as TranslationKey[]
const langs: Lang[] = ['en', 'zh']

describe('translations object', () => {
  it('has at least one key', () => {
    expect(allKeys.length).toBeGreaterThan(0)
  })

  it('every key has a non-empty English value', () => {
    for (const key of allKeys) {
      expect(translations[key].en).toBeTruthy()
    }
  })

  it('every key has a non-empty Chinese value', () => {
    for (const key of allKeys) {
      expect(translations[key].zh).toBeTruthy()
    }
  })

  it('contains no OTP-related keys (those were removed with OTP auth)', () => {
    const otpKeys = allKeys.filter(k => k.includes('otp') || k === 'auth.send' || k === 'auth.verify' || k === 'auth.resend')
    expect(otpKeys).toHaveLength(0)
  })
})

describe('t() helper', () => {
  it.each(langs)('returns a string for every key in %s', (lang) => {
    for (const key of allKeys) {
      expect(typeof t(key, lang)).toBe('string')
      expect(t(key, lang).length).toBeGreaterThan(0)
    }
  })

  it('returns the correct English value for nav.home', () => {
    expect(t('nav.home', 'en')).toBe('Home')
  })

  it('returns the correct Chinese value for nav.home', () => {
    expect(t('nav.home', 'zh')).toBe('首页')
  })

  it('auth.email.label exists in both languages', () => {
    expect(t('auth.email.label', 'en')).toBe('Email address')
    expect(t('auth.email.label', 'zh')).toBe('邮箱地址')
  })
})
