// ============================================================
// lib/access.ts — Route access configuration
//
// Three tiers:
//   'public'  — anyone can access (no login required)
//   'member'  — any logged-in member (active, inactive, or pending)
//   'active'  — active members only (status === 'active')
//
// HOW TO TOGGLE CONTENT ACCESS
// ─────────────────────────────
// To make a route require a login:       change 'public'  → 'member'
// To make a route require active status: change 'member'  → 'active'
//                                    or: change 'public'  → 'active'
// To open a route to everyone:           change 'member'  → 'public'
//                                    or: change 'active'  → 'public'
//
// Rules are evaluated top-to-bottom — first prefix match wins.
// Unmatched paths default to 'public'.
// ============================================================

export type AccessTier = 'public' | 'member' | 'active'

export interface AccessRule {
  prefix: string
  tier:   AccessTier
  /** Optional human-readable description for why this tier was chosen */
  note?:  string
}

export const ACCESS_CONFIG: AccessRule[] = [
  // ── Active membership required ─────────────────────────────────────────────
  // Profile page is accessible to any logged-in member (including expired) so
  // they can see their account info and get a link to renew.
  { prefix: '/portal/profile',     tier: 'member', note: 'Profile — any logged-in member (including expired)' },
  { prefix: '/portal',             tier: 'active', note: 'Member portal — active membership required' },
  { prefix: '/api/photos',         tier: 'active', note: 'Photo service — active members only' },
  { prefix: '/api/bibs',           tier: 'active', note: 'Bib management — active members only' },

  // ── Any logged-in member ───────────────────────────────────────────────────
  { prefix: '/api/members/me',     tier: 'member', note: 'Own profile — any logged-in member' },
  { prefix: '/api/members/search', tier: 'member', note: 'Member search — any logged-in member' },
  { prefix: '/api/payments',       tier: 'member', note: 'Payments — pending members need this to submit proof' },

  // ── Public ─────────────────────────────────────────────────────────────────
  //
  // Blog posts are public so search engines and prospective members can read them.
  // To make the blog member-only: change tier below to 'member'
  // To require active membership: change tier below to 'active'
  { prefix: '/blog',               tier: 'public', note: 'Blog — open to everyone' },
  { prefix: '/events',             tier: 'public', note: 'Events — open to everyone' },
  { prefix: '/join',               tier: 'public', note: 'Join / renew page — open to everyone' },
  { prefix: '/login',              tier: 'public' },
  { prefix: '/membership',         tier: 'public', note: 'Membership status / inactive page — must be reachable without active status' },
  { prefix: '/api/auth',           tier: 'public' },
  { prefix: '/auth/forgot-password',  tier: 'public', note: 'Forgot-password page — unauthenticated users only' },
  { prefix: '/auth/reset-password',   tier: 'public', note: 'Reset-password page — unauthenticated users only' },
  { prefix: '/auth/setup-password',   tier: 'public', note: 'First-time password setup for existing members' },
  { prefix: '/auth/complete',         tier: 'public', note: 'NextAuth→mmr_session bridge — called after OAuth/Credentials sign-in' },

  // Admin area (not yet built — placeholder)
  { prefix: '/admin',              tier: 'active', note: 'Admin — requires active membership; add role check in each route' },
]

/**
 * Returns the access tier required for a given pathname.
 * First matching prefix wins; unmatched paths are 'public'.
 */
export function getRequiredTier(pathname: string): AccessTier {
  const rule = ACCESS_CONFIG.find(r => pathname.startsWith(r.prefix))
  return rule?.tier ?? 'public'
}
