import { redirect } from 'next/navigation'
import { cookies, headers } from 'next/headers'
import { requireSession, createSession, setSessionCookie } from '@/lib/auth/session'
import { findMemberByEmail } from '@/lib/db/members'
import Navbar from '@/components/layout/Navbar'
import Footer from '@/components/layout/Footer'
import PortalSidebar from '@/components/member/PortalSidebar'
import Link from 'next/link'

export default async function MemberLayout({ children }: { children: React.ReactNode }) {
  let session
  try {
    session = await requireSession()
  } catch {
    redirect('/login?from=/portal')
  }

  // Read the current pathname from the header set by middleware
  const headersList = await headers()
  const xPathname = headersList.get('x-pathname') ?? '/portal'

  // If the JWT says non-active, do a live DB check — an admin may have approved
  // the member since they last logged in. If so, re-issue the session cookie so
  // the user gets through without having to log out and back in.
  if (session.status !== 'active') {
    try {
      const fresh = await findMemberByEmail(session.email)
      if (fresh?.status === 'active') {
        const token = await createSession({
          memberId:  fresh.memberId,
          email:     fresh.email,
          firstName: fresh.firstName,
          lastName:  fresh.lastName,
          status:    fresh.status,
        })
        const cookieStore = await cookies()
        cookieStore.set(setSessionCookie(token))
        // Update in-memory session so the rest of the layout sees 'active'
        session = { ...session, status: fresh.status, firstName: fresh.firstName }
      }
    } catch {
      // DB unavailable — fall through with the JWT's status
    }
  }

  // ── Expired members: allow access to /portal/profile only ─────────────────
  // Expired members get a simplified layout (no sidebar) with an expiry banner.
  if (session.status === 'expired') {
    const firstName = session.firstName ?? undefined
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col">
        <Navbar isLoggedIn={true} firstName={firstName} />

        {/* Expiry banner */}
        <div className="bg-amber-50 border-b border-amber-200 px-4 py-3 text-center text-sm text-amber-800">
          Your membership has expired.{' '}
          <Link href="/join" className="font-semibold underline hover:text-amber-900">
            Renew now →
          </Link>
          {' '}to restore full access.
        </div>

        <div className="flex-1 max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-8 w-full">
          <main className="animate-fade-in">
            {children}
          </main>
        </div>
        <Footer />
      </div>
    )
  }

  // ── Belt-and-suspenders: redirect all other non-active members ─────────────
  // Middleware already enforces this at the edge, but we re-check here in case
  // of SSR cache scenarios. 'expired' is handled above and never reaches here.
  if (session.status !== 'active') {
    redirect(`/membership/inactive?status=${session.status}&from=${encodeURIComponent(xPathname)}`)
  }

  const firstName = session.firstName ?? undefined

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <Navbar isLoggedIn={true} firstName={firstName} />
      <div className="flex-1 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 w-full">
        <div className="flex gap-8">
          <PortalSidebar session={session} />
          <main className="flex-1 min-w-0 animate-fade-in">
            {children}
          </main>
        </div>
      </div>
      <Footer />
    </div>
  )
}
