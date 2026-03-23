import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import { requireSession, createSession, setSessionCookie } from '@/lib/auth/session'
import { findMemberByEmail } from '@/lib/db/members'
import Navbar from '@/components/layout/Navbar'
import Footer from '@/components/layout/Footer'
import PortalSidebar from '@/components/member/PortalSidebar'

export default async function MemberLayout({ children }: { children: React.ReactNode }) {
  let session
  try {
    session = await requireSession()
  } catch {
    redirect('/login?from=/portal')
  }

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
        // Use fresh.status (typed as MemberStatus) instead of the bare string 'active'
        // to preserve the narrowed union type and satisfy PortalSidebar's SessionUser prop.
        session = { ...session, status: fresh.status, firstName: fresh.firstName }
      }
    } catch {
      // DB unavailable — fall through with the JWT's status
    }
  }

  // Belt-and-suspenders: middleware already enforces this at the edge,
  // but we re-check here in case of SSR cache scenarios.
  if (session.status !== 'active') {
    redirect(`/membership/inactive?status=${session.status}&from=/portal`)
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
