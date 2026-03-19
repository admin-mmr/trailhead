import Navbar from '@/components/layout/Navbar'
import Footer from '@/components/layout/Footer'
import { getSession } from '@/lib/auth/session'

export default async function PublicLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession()
  return (
    <>
      <Navbar isLoggedIn={!!session} />
      <main className="min-h-screen">{children}</main>
      <Footer />
    </>
  )
}
