/**
 * Unit tests for lib/safe-url.ts
 *
 * This is the guard between the admin-editable `config` table and an href.
 * React escapes text but renders href="javascript:…" happily, so a config row is
 * a stored-XSS vector unless its scheme is checked. Every bypass technique below
 * is a real one, so they stay pinned.
 */

import { isSafeHttpUrl, safeHttpUrlOr } from '@/lib/safe-url'

describe('isSafeHttpUrl — accepts', () => {
  it.each([
    'https://mmr-data-pipeline.web.app/',
    'http://example.com',
    'https://example.com/path?a=1#frag',
    'https://sub.domain.example.com:8443/deep/path',
  ])('%s', (url) => {
    expect(isSafeHttpUrl(url)).toBe(true)
  })
})

describe('isSafeHttpUrl — rejects dangerous schemes', () => {
  it.each([
    'javascript:alert(1)',
    'JavaScript:alert(1)',
    'JAVASCRIPT:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'vbscript:msgbox(1)',
    'file:///etc/passwd',
    'mailto:someone@example.com',
    'tel:+12125550000',
    'ftp://example.com',
    'blob:https://example.com/uuid',
  ])('%s', (url) => {
    expect(isSafeHttpUrl(url)).toBe(false)
  })

  it('rejects whitespace and control-character obfuscation', () => {
    // Browsers strip these before dispatching, so "java\nscript:" is live in an
    // href even though a naive startsWith('javascript:') check passes it.
    expect(isSafeHttpUrl('java\nscript:alert(1)')).toBe(false)
    expect(isSafeHttpUrl('java\tscript:alert(1)')).toBe(false)
    expect(isSafeHttpUrl('java\0script:alert(1)')).toBe(false)
    expect(isSafeHttpUrl(' javascript:alert(1)')).toBe(false)
    expect(isSafeHttpUrl('javascript:alert(1)')).toBe(false)
  })

  it('rejects leading and trailing whitespace even on a safe URL', () => {
    expect(isSafeHttpUrl(' https://example.com')).toBe(false)
    expect(isSafeHttpUrl('https://example.com ')).toBe(false)
    expect(isSafeHttpUrl('\nhttps://example.com')).toBe(false)
  })
})

describe('isSafeHttpUrl — rejects non-absolute and non-string input', () => {
  it.each([
    '//evil.example.com',   // protocol-relative: no scheme to validate
    '/portal/photos',
    'example.com',
    'not a url',
    '',
    '   ',
  ])('%s', (url) => {
    expect(isSafeHttpUrl(url)).toBe(false)
  })

  it.each([null, undefined, 0, 42, {}, [], true])('non-string %p', (value) => {
    expect(isSafeHttpUrl(value)).toBe(false)
  })
})

describe('safeHttpUrlOr', () => {
  const FALLBACK = 'https://mmr-data-pipeline.web.app/'

  it('passes a safe value through unchanged', () => {
    expect(safeHttpUrlOr('https://example.com/gallery', FALLBACK)).toBe(
      'https://example.com/gallery'
    )
  })

  it('falls back rather than rendering a hostile href', () => {
    expect(safeHttpUrlOr('javascript:alert(1)', FALLBACK)).toBe(FALLBACK)
    expect(safeHttpUrlOr('data:text/html,x', FALLBACK)).toBe(FALLBACK)
  })

  it('falls back for empty, missing and malformed values', () => {
    for (const bad of ['', '   ', null, undefined, 'nope', 42]) {
      expect(safeHttpUrlOr(bad, FALLBACK)).toBe(FALLBACK)
    }
  })

  it('returns null when the fallback is unusable too, so callers can hide the link', () => {
    expect(safeHttpUrlOr('javascript:alert(1)', 'also-bad')).toBeNull()
    expect(safeHttpUrlOr(null, '')).toBeNull()
  })
})
