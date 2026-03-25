import { getSession } from '@/lib/auth/session'
import { isAdmin } from '@/lib/db/admins'
import Navbar from './Navbar'

/**
 * Server component that fetches the session and admin status,
 * then renders the client-side Navbar with all the data it needs.
 */
export default async function NavbarServer() {
  const session = await getSession()
  let admin = false
  if (session?.email) {
    try {
      admin = await isAdmin(session.email)
    } catch {
      // DB unavailable — treat as non-admin
    }
  }
  return (
    <Navbar
      session={session}
      isAdmin={admin}
    />
  )
}
