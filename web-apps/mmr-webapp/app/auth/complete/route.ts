// ============================================================
// /auth/complete — OAuth/Credentials bridge
//
// NextAuth redirects here (via callbackUrl) after any
// successful sign-in. This route:
//   1. Reads the NextAuth session (email, provider, sub)
//   2. Looks the member up by email — never creates one
//   3. Persists the OAuth sub ID (google_sub, etc.)
//   4. Creates our custom mmr_session JWT cookie
//   5. Redirects to /portal, or to /login?error=oauth_no_member
//      when the signed-in address matches no member
//
// This keeps all existing middleware, getSession(), and API
// routes completely unchanged.
//
// NOTE: We use `auth(handler)` wrapper form (not `await auth()`) because
// in NextAuth v5 Route Handlers, the wrapped form reliably receives the
// NextAuth session directly on req.auth, whereas `await auth()` without
// a request argument can silently return null in some beta versions.
// ============================================================

import { NextResponse }                           from 'next/server'
import { cookies }                                from 'next/headers'
import { auth }                                   from '@/auth'
import { findMemberByEmail,
         updateMemberOAuthSub }                   from '@/lib/db/members'
import { createSession, setSessionCookie }        from '@/lib/auth/session'
import { isExpiredNY }                            from '@/lib/date'

const BASE_URL = process.env.NEXTAUTH_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'

// Every successful sign-in lands here. There is no longer a '/join' branch:
// this route only ever signs in an EXISTING member (see the lookup below), and
// the portal itself sends inactive/pending members onward via middleware.
const DESTINATION = '/portal'

export const GET = auth(async function handler(req) {
  const nextAuthSession = req.auth

  console.log('[auth/complete] req.auth:', nextAuthSession
    ? `email=${nextAuthSession.user?.email} provider=${(nextAuthSession as any).provider}`
    : 'NULL — session not found in wrapped handler')

  if (!nextAuthSession?.user?.email) {
    console.log('[auth/complete] ⛔ No session email — redirecting to /login?error=oauth_failed')
    return NextResponse.redirect(new URL('/login?error=oauth_failed', BASE_URL))
  }

  const email             = nextAuthSession.user.email
  const provider          = (nextAuthSession as any).provider          as string | undefined
  const providerAccountId = (nextAuthSession as any).providerAccountId as string | undefined

  // ── Look up the member by email ────────────────────────────────────────────
  //
  // This route NEVER creates a member. It used to: an unrecognised OAuth email
  // minted a fresh 'pending' row and sent the person to /join. That silently
  // forked existing members onto a second MemberID whenever the address on
  // their Google/Microsoft account differed from the one on file — and 130+
  // active members are on yahoo/hotmail/aol/msn, so a mismatch is the norm,
  // not the edge case. Signing in is not signing up; membership is created by
  // /join and by the admin panel, and both collect data (phone, district,
  // membership type, payment) that a social profile cannot supply.
  const member = await findMemberByEmail(email)
  console.log('[auth/complete] DB lookup:', member ? `found memberId=${member.memberId} status=${member.status}` : 'no member for this address')

  if (!member) {
    // Deliberately no email in the query string — it would land in browser
    // history and edge logs. The login page explains the mismatch generically.
    console.log('[auth/complete] ⛔ no member matches the signed-in address — redirecting to /login?error=oauth_no_member')
    return NextResponse.redirect(new URL('/login?error=oauth_no_member', BASE_URL))
  }

  // ── Persist the OAuth sub so future logins skip DB lookup ─────────────────
  if (provider && providerAccountId) {
    await updateMemberOAuthSub(member.memberId, provider, providerAccountId)
  }

  // ── Determine effective status (check for expired active memberships) ────
  // If the DB says 'active' but ExpiresAt has passed, use 'expired' in the JWT
  // so the middleware can route the member to a limited-access view rather than
  // redirecting them straight to /login as if they were never a member.
  //
  // isExpiredNY() compares dates in America/New_York so a member who expires
  // on March 31 is still 'active' until midnight NY time — not UTC midnight
  // (which would flag them expired 4-5 hours early on the evening of March 30).
  const isExpiredActive =
    member.status === 'active' &&
    isExpiredNY(member.expiresAt)
  const effectiveStatus = isExpiredActive ? ('expired' as const) : member.status

  // ── Create our custom session cookie ──────────────────────────────────────
  const token = await createSession({
    memberId:  member.memberId,
    email:     member.email,
    firstName: member.firstName,
    lastName:  member.lastName,
    status:    effectiveStatus,
  })
  console.log('[auth/complete] ✅ mmr_session JWT created, length:', token.length, 'status:', effectiveStatus, isExpiredActive ? '(expired active)' : '')

  // Use cookies() from next/headers to set the cookie at the framework level.
  // Setting it directly on a NextResponse object returned from inside the
  // auth() wrapper is unreliable — NextAuth v5 beta can silently drop
  // Set-Cookie headers when it processes the inner handler's response.
  try {
    const cookieStore = await cookies()
    cookieStore.set(setSessionCookie(token))
    console.log('[auth/complete] ✅ cookie set via next/headers cookies()')
  } catch (err) {
    console.error('[auth/complete] ❌ cookies().set() failed:', err)
    // Fallback: set cookie on the response object directly
    const res = NextResponse.redirect(new URL(DESTINATION, BASE_URL))
    res.cookies.set(setSessionCookie(token))
    console.log('[auth/complete] → fallback: cookie set on NextResponse, redirecting to:', DESTINATION)
    return res
  }

  console.log('[auth/complete] → redirecting to:', DESTINATION)
  return NextResponse.redirect(new URL(DESTINATION, BASE_URL))
})
