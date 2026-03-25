import { NextRequest, NextResponse } from 'next/server'
import { clearSessionCookie } from '@/lib/auth/session'

export const dynamic = 'force-dynamic'

export function GET(req: NextRequest) {
  // Redirect to login page with goodbye banner instead of home
  const origin = process.env.NEXT_PUBLIC_APP_URL ?? new URL(req.nextUrl).origin
  const res = NextResponse.redirect(new URL('/login?goodbye=1', origin))
  res.cookies.set(clearSessionCookie())
  return res
}
