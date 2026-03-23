import Navbar from '@/components/layout/Navbar'
import Footer from '@/components/layout/Footer'
import { getSession } from '@/lib/auth/session'

export default async function PublicLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession()
  const firstName = session?.firstName ?? undefined
  return (
    <>
      <Navbar isLoggedIn={!!session} firstName={firstName} />
      <main className="min-h-screen">{children}</main>
      <Footer />
    </>
  )
}
