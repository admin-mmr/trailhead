import { NextRequest, NextResponse } from 'next/server'
import { clearSessionCookie } from '@/lib/auth/session'

export const dynamic = 'force-dynamic'

export function GET(req: NextRequest) {
  // Derive base URL from the incoming request so this works in any environment
  // (localhost, staging, production) without relying on NEXT_PUBLIC_APP_URL.
  const origin = process.env.NEXT_PUBLIC_APP_URL ?? new URL(req.nextUrl).origin
  const res = NextResponse.redirect(new URL('/', origin))
  res.cookies.set(clearSessionCookie())
  return res
}
