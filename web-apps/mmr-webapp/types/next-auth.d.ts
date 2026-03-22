// Extend NextAuth Session and JWT types so provider info flows
// from the OAuth callback through to the /auth/complete bridge.

import 'next-auth'
import 'next-auth/jwt'

declare module 'next-auth' {
  interface Session {
    /** OAuth provider id e.g. "google", "apple", "microsoft-entra-id" */
    provider?: string
    /** Provider's subject ID for the user */
    providerAccountId?: string
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    provider?: string
    providerAccountId?: string
  }
}
