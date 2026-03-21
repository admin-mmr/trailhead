// ============================================================
// middleware.ts — Edge-compatible access control
//
// Enforces the three access tiers defined in lib/access.ts:
//   public  → pass through
//   member  → must have a valid session (any status)
//   active  → must have a valid session AND status === 'active'
//
// Inactive / pending members hitting an 'active' route are redirected
// to /membership/inactive (not to /login) so they see a helpful message
// with a renewal CTA rather than a confusing login screen.
//
// Status is read directly from the JWT payload (no DB round-trip).
// After a member renews, call GET /api/auth/refresh-session to issue
// a fresh token with the updated status before redirecting to the portal.
// ============================================================

import { NextRequest, NextResponse } from 'next/server'
import { jwtVerify }                  from 'jose'
import { getRequiredTier }            from '@/lib/access'

const SECRET = new TextEncoder().encode(process.env.JWT_SECRET!)

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl
  const tier = getRequiredTier(pathname)

  // Public routes — no checks needed
  if (tier === 'public') return NextResponse.next()

  const token = req.cookies.get('mmr_session')?.value
  if (!token) return toLogin(req)

  try {
    const { payload } = await jwtVerify(token, SECRET)

    if (tier === 'active' && payload.status !== 'active') {
      // Authenticated but membership is inactive or pending
      const dest = new URL('/membership/inactive', req.url)
      dest.searchParams.set('from', pathname)
      dest.searchParams.set('status', String(payload.status ?? 'inactive'))
      return NextResponse.redirect(dest)
    }

    return NextResponse.next()
  } catch {
    // Token invalid or expired
    return toLogin(req)
  }
}

function toLogin(req: NextRequest): NextResponse {
  const url = new URL('/login', req.url)
  url.searchParams.set('from', req.nextUrl.pathname)
  return NextResponse.redirect(url)
}

export const config = {
  // Run on all paths except Next.js internals and static files.
  // The matcher is intentionally broad — getRequiredTier() returns 'public'
  // for anything not in ACCESS_CONFIG, so those paths flow straight through.
  matcher: [
    '/((?!_next/static|_next/image|favicon\\.ico|.*\\.(?:png|jpg|jpeg|gif|svg|ico|webp|woff2?|ttf|otf|eot|css|js)).*)',
  ],
}
