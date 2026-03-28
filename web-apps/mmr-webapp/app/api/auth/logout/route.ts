import { NextRequest, NextResponse } from 'next/server'
import { clearSessionCookie } from '@/lib/auth/session'

export const dynamic = 'force-dynamic'

/**
 * GET /api/auth/logout
 *
 * Clears both the custom mmr_session JWT and the NextAuth session cookie,
 * then redirects to the login page with a goodbye banner.
 *
 * We need to clear both cookies because:
 * - mmr_session: our custom JWT used by middleware and API routes
 * - authjs.session-token / __Secure-authjs.session-token: NextAuth's cookie
 *   (if left behind, the NavbarServer or refresh-session fallback could
 *    still consider the user partially logged in)
 */
export function GET(req: NextRequest) {
  const origin = process.env.NEXT_PUBLIC_APP_URL ?? new URL(req.nextUrl).origin
  const res = NextResponse.redirect(new URL('/login?goodbye=1', origin))

  // Clear our custom session
  res.cookies.set(clearSessionCookie())

  // Clear NextAuth session cookie (name differs by environment)
  // In production (HTTPS): __Secure-authjs.session-token
  // In development (HTTP):  authjs.session-token
  const isSecure = process.env.NODE_ENV === 'production'

  res.cookies.set({
    name: isSecure ? '__Secure-authjs.session-token' : 'authjs.session-token',
    value: '',
    maxAge: 0,
    path: '/',
    httpOnly: true,
    secure: isSecure,
    sameSite: 'lax',
  })

  // Also clear the non-prefixed variant just in case (some NextAuth configs use it)
  if (isSecure) {
    res.cookies.set({
      name: 'authjs.session-token',
      value: '',
      maxAge: 0,
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
    })
  }

  return res
}
