/**
 * Tests for lib/auth/password.ts
 *
 * Tests bcrypt hash/verify without hitting the DB or network.
 * Run with: npm test
 */

import { hashPassword, verifyPassword } from '@/lib/auth/password'

describe('hashPassword', () => {
  it('returns a bcrypt hash string', async () => {
    const hash = await hashPassword('TestPassword123!')
    expect(hash).toMatch(/^\$2[aby]\$\d{2}\$/)
  })

  it('produces a different hash each call (salted)', async () => {
    const h1 = await hashPassword('SamePassword')
    const h2 = await hashPassword('SamePassword')
    expect(h1).not.toBe(h2)
  })

  it('hash length is at least 60 characters', async () => {
    const hash = await hashPassword('short')
    expect(hash.length).toBeGreaterThanOrEqual(60)
  })
})

describe('verifyPassword', () => {
  it('returns true when plaintext matches the hash', async () => {
    const password = 'CorrectHorseBatteryStaple'
    const hash = await hashPassword(password)
    expect(await verifyPassword(password, hash)).toBe(true)
  })

  it('returns false when plaintext does not match', async () => {
    const hash = await hashPassword('CorrectPassword')
    expect(await verifyPassword('WrongPassword', hash)).toBe(false)
  })

  it('returns false for an empty string against a real hash', async () => {
    const hash = await hashPassword('SomePassword')
    expect(await verifyPassword('', hash)).toBe(false)
  })
})
