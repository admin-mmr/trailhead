// ============================================================
// middleware.ts — Edge-compatible access control
//
// Enforces the access tiers defined in lib/access.ts:
//   public  → pass through
//   member  → must have a valid session (any status)
//   active  → must have a valid session AND status === 'active'
//   admin   → must have a valid session, active status, AND be in the admins table
//             (admin DB check happens at the route handler level since we can't
//              query MySQL at the edge; middleware only checks active status)
//
// Inactive / pending members hitting an 'active' route are redirected
// to /membership/inactive (not to /login) so they see a helpful message
// with a renewal CTA rather than a confusing login screen.
// ============================================================

import { NextRequest, NextResponse } from 'next/server'
import { jwtVerify }                  from 'jose'
import { getRequiredTier }            from '@/lib/access'

const SECRET = new TextEncoder().encode(process.env.JWT_SECRET!)

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl
  const tier = getRequiredTier(pathname)

  // Forward the pathname as a header so server-component layouts can read it
  const requestHeaders = new Headers(req.headers)
  requestHeaders.set('x-pathname', pathname)

  // Public routes — no checks needed (but still forward the pathname header)
  if (tier === 'public') {
    return NextResponse.next({ request: { headers: requestHeaders } })
  }

  const token = req.cookies.get('mmr_session')?.value
  console.log(`[middleware] ${pathname} | tier=${tier} | mmr_session cookie: ${token ? `present (${token.length} chars)` : 'MISSING'}`)
  if (!token) return toLogin(req)

  try {
    const { payload } = await jwtVerify(token, SECRET)
    console.log(`[middleware] ${pathname} | JWT valid | status=${payload.status}`)

    // 'admin' tier at the edge: require active status (actual admin check in route handlers)
    if ((tier === 'active' || tier === 'admin') && payload.status !== 'active') {
      const dest = new URL('/membership/inactive', req.url)
      dest.searchParams.set('from', pathname)
      dest.searchParams.set('status', String(payload.status ?? 'inactive'))
      return NextResponse.redirect(dest)
    }

    return NextResponse.next({ request: { headers: requestHeaders } })
  } catch (err) {
    console.log(`[middleware] ${pathname} | JWT verification FAILED:`, (err as Error).message)
    return toLogin(req)
  }
}

function toLogin(req: NextRequest): NextResponse {
  const url = new URL('/login', req.url)
  url.searchParams.set('from', req.nextUrl.pathname)
  return NextResponse.redirect(url)
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon\\.ico|.*\\.(?:png|jpg|jpeg|gif|svg|ico|webp|woff2?|ttf|otf|eot|css|js)).*)',
  ],
}
