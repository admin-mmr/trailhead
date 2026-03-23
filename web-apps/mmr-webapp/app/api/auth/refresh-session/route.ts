// ============================================================
// POST /api/auth/refresh-session
//
// Re-reads the member's current status from the database and
// issues a fresh JWT cookie with the up-to-date information.
//
// Called from /membership/inactive after a member renews their
// membership, so the middleware picks up the new 'active' status
// without requiring the member to log out and back in.
//
// Returns: { status: MemberStatus }
// ============================================================

import { NextRequest, NextResponse }           from 'next/server'
import { getSession, createSession, setSessionCookie } from '@/lib/auth/session'
import { findMemberByEmail }                   from '@/lib/db/members'

export async function POST(_req: NextRequest): Promise<NextResponse> {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 })
  }

  try {
    const member = await findMemberByEmail(session.email)
    if (!member) {
      return NextResponse.json({ error: 'Member not found.' }, { status: 404 })
    }

    // Detect expired active memberships (same logic as /auth/complete)
    const isExpiredActive =
      member.status === 'active' &&
      !!member.expiresAt &&
      new Date(member.expiresAt) < new Date()
    const effectiveStatus = isExpiredActive ? ('expired' as const) : member.status

    // Issue a fresh JWT with the latest status
    const token = await createSession({
      memberId:  member.memberId,
      email:     member.email,
      firstName: member.firstName,
      lastName:  member.lastName,
      status:    effectiveStatus,
    })

    const res = NextResponse.json({ status: effectiveStatus })
    res.cookies.set(setSessionCookie(token))
    return res
  } catch (err) {
    console.error('[POST /api/auth/refresh-session]', err)
    return NextResponse.json({ error: 'Failed to refresh session.' }, { status: 500 })
  }
}
