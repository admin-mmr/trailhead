// NextAuth v5 route handler — handles all /api/auth/* routes
// (signin, callback/*, signout, session, csrf, providers)
import { handlers } from '@/auth'
export const { GET, POST } = handlers
