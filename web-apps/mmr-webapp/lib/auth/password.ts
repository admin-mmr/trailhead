// ============================================================
// lib/auth/password.ts — bcrypt password helpers
//
// Uses bcryptjs (pure JS) — safe in Node.js API routes.
// Cost factor 12: ~300ms on modern hardware, good balance
// between security and performance.
// ============================================================

import bcrypt from 'bcryptjs'

const COST = 12

export async function hashPassword(plaintext: string): Promise<string> {
  return bcrypt.hash(plaintext, COST)
}

export async function verifyPassword(plaintext: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plaintext, hash)
}
