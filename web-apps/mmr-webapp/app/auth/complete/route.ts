// ============================================================
// /auth/complete — OAuth/Credentials bridge
//
// NextAuth redirects here (via callbackUrl) after any
// successful sign-in. This route:
//   1. Reads the NextAuth session (email, provider, sub)
//   2. Looks up or creates the member in our DB
//   3. Persists the OAuth sub ID (google_sub, etc.)
//   4. Creates our custom mmr_session JWT cookie
//   5. Redirects to /portal (or /join for brand-new members)
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
import { findMemberByEmail, createNewMember,
         updateMemberOAuthSub }                   from '@/lib/db/members'
import { createSession, setSessionCookie }        from '@/lib/auth/session'

const BASE_URL = process.env.NEXTAUTH_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'

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

  // ── Look up or create member by email ──────────────────────────────────────
  let member = await findMemberByEmail(email)
  const isNew = !member
  console.log('[auth/complete] DB lookup:', member ? `found memberId=${member.memberId} status=${member.status}` : 'not found — will create')

  if (!member) {
    // Split the OAuth display name (e.g. "Jane Doe") into firstName / lastName
    const displayName  = nextAuthSession.user.name ?? ''
    const spaceIdx     = displayName.indexOf(' ')
    const firstName    = spaceIdx > -1 ? displayName.slice(0, spaceIdx) : displayName || undefined
    const lastName     = spaceIdx > -1 ? displayName.slice(spaceIdx + 1) : undefined

    member = await createNewMember({
      email,
      firstName,
      lastName,
      membershipType: 'individual',
    })
    console.log('[auth/complete] created new member, memberId:', member.memberId)
  }

  // ── Persist the OAuth sub so future logins skip DB lookup ─────────────────
  if (provider && providerAccountId) {
    await updateMemberOAuthSub(member.memberId, provider, providerAccountId)
  }

  // ── Create our custom session cookie ──────────────────────────────────────
  const token = await createSession({
    memberId:  member.memberId,
    email:     member.email,
    firstName: member.firstName,
    lastName:  member.lastName,
    status:    member.status,
  })
  console.log('[auth/complete] ✅ mmr_session JWT created, length:', token.length, 'status:', member.status)

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
    const destination = isNew ? '/join' : '/portal'
    const res = NextResponse.redirect(new URL(destination, BASE_URL))
    res.cookies.set(setSessionCookie(token))
    console.log('[auth/complete] → fallback: cookie set on NextResponse, redirecting to:', destination)
    return res
  }

  const destination = isNew ? '/join' : '/portal'
  console.log('[auth/complete] → redirecting to:', destination)
  return NextResponse.redirect(new URL(destination, BASE_URL))
})
