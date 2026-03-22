// ============================================================
// /api/health — Temporary diagnostic endpoint
//
// Checks that all required environment variables are present
// and that the database connection is working.
//
// ⚠️  DELETE THIS FILE after debugging is complete.
// ============================================================

import { NextResponse }      from 'next/server'
import { findMemberByEmail } from '@/lib/db/members'

export async function GET() {
  const checks: Record<string, any> = {}

  // ── Environment variable presence check ──────────────────
  checks.env = {
    DATABASE_URL:      !!process.env.DATABASE_URL,
    NEXTAUTH_SECRET:   !!process.env.NEXTAUTH_SECRET,
    NEXTAUTH_URL:      process.env.NEXTAUTH_URL       ?? '(not set)',
    JWT_SECRET:        !!process.env.JWT_SECRET,
    JWT_EXPIRY:        process.env.JWT_EXPIRY         ?? '(not set)',
    GOOGLE_CLIENT_ID:  !!process.env.GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET: !!process.env.GOOGLE_CLIENT_SECRET,
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL ?? '(not set)',
    NODE_ENV:          process.env.NODE_ENV           ?? '(not set)',
  }

  // ── Database connectivity check ───────────────────────────
  try {
    await findMemberByEmail('health-check-nonexistent@example.com')
    checks.db = 'ok'
  } catch (e: any) {
    checks.db = `ERROR: ${e.message}`
  }

  const allEnvOk = Object.values(checks.env).every(v => v !== false && v !== '(not set)')
  const dbOk     = checks.db === 'ok'

  return NextResponse.json(
    { status: allEnvOk && dbOk ? 'ok' : 'degraded', ...checks },
    { status: allEnvOk && dbOk ? 200 : 500 }
  )
}
