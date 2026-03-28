import { getSession } from '@/lib/auth/session'
import Navbar from './Navbar'

/**
 * Server component that fetches the session,
 * then renders the client-side Navbar with the data it needs.
 */
export default async function NavbarServer() {
  const session = await getSession()
  return <Navbar session={session} />
}
