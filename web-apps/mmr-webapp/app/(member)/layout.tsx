import { redirect } from 'next/navigation'
import { requireSession } from '@/lib/auth/session'
import Navbar from '@/components/layout/Navbar'
import PortalSidebar from '@/components/member/PortalSidebar'

export default async function MemberLayout({ children }: { children: React.ReactNode }) {
  let session
  try {
    session = await requireSession()
  } catch {
    redirect('/login?from=/portal')
  }

  // Belt-and-suspenders: middleware already enforces this at the edge,
  // but we re-check here in case of SSR cache scenarios.
  if (session.status !== 'active') {
    redirect(`/membership/inactive?status=${session.status}&from=/portal`)
  }

  const firstName = session.englishName?.split(' ')[0] ?? session.chineseName ?? undefined

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar isLoggedIn={true} firstName={firstName} />
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex gap-8">
          <PortalSidebar session={session} />
          <main className="flex-1 min-w-0 animate-fade-in">
            {children}
          </main>
        </div>
      </div>
    </div>
  )
}
