// ============================================================
// lib/access.ts — Route access configuration
//
// Four tiers:
//   'public'  — anyone can access (no login required)
//   'member'  — any logged-in member (active, inactive, or pending)
//   'active'  — active members only (status === 'active')
//   'admin'   — active members with admin role (edge: checks active; route: checks DB)
//
// Rules are evaluated top-to-bottom — first prefix match wins.
// Unmatched paths default to 'public'.
// ============================================================

export type AccessTier = 'public' | 'member' | 'active' | 'admin'

export interface AccessRule {
  prefix: string
  tier:   AccessTier
  /** Optional human-readable description for why this tier was chosen */
  note?:  string
}

export const ACCESS_CONFIG: AccessRule[] = [
  // ── Admin ──────────────────────────────────────────────────────────────────
  { prefix: '/admin',              tier: 'admin',  note: 'Admin area — requires active membership + admin role' },
  { prefix: '/api/admin',          tier: 'active', note: 'Admin API — active required at edge; admin check in route handler' },

  // ── Active membership required ─────────────────────────────────────────────
  { prefix: '/portal/profile',     tier: 'member', note: 'Profile — any logged-in member (including expired)' },
  { prefix: '/portal',             tier: 'active', note: 'Member portal — active membership required' },
  { prefix: '/api/photos',         tier: 'active', note: 'Photo service — active members only' },
  { prefix: '/api/bibs',           tier: 'active', note: 'Bib management — active members only' },
  // NB: the public '/events' rule below does NOT cover this — prefix matching is
  // literal, so '/api/events' would fall through to the 'public' default and
  // expose member RSVP data. Keep this rule.
  { prefix: '/api/events',         tier: 'active', note: 'Member event calendar + RSVP — active members only' },

  // ── Any logged-in member ───────────────────────────────────────────────────
  { prefix: '/payment-proof',      tier: 'member', note: 'Standalone proof upload — pending/expired members need this outside the active-gated /portal' },
  { prefix: '/api/members/me',     tier: 'member', note: 'Own profile — any logged-in member' },
  { prefix: '/api/members/search', tier: 'member', note: 'Member search — any logged-in member' },
  { prefix: '/api/payments/submit', tier: 'public', note: 'Join wizard payment declaration — new members have no session yet' },
  { prefix: '/api/payments/stripe', tier: 'public', note: 'Stripe checkout (amount from DB, anonymous join/donate) + webhook (auth = Stripe signature)' },
  { prefix: '/api/payments',       tier: 'member', note: 'Payments — pending members need this to submit proof' },
  { prefix: '/payment/success',    tier: 'public', note: 'Stripe Checkout return page' },

  // ── Public ─────────────────────────────────────────────────────────────────
  { prefix: '/blog',               tier: 'public', note: 'Blog — open to everyone' },
  { prefix: '/events',             tier: 'public', note: 'Events — open to everyone' },
  { prefix: '/join',               tier: 'public', note: 'Join / renew page — open to everyone' },
  { prefix: '/donate',             tier: 'public', note: 'Donate page — open to everyone' },
  { prefix: '/login',              tier: 'public' },
  { prefix: '/membership',         tier: 'public', note: 'Membership status / inactive page — must be reachable without active status' },
  { prefix: '/api/auth',           tier: 'public' },
  { prefix: '/api/donations',      tier: 'public', note: 'Donation submission — open to everyone (like join flow)' },
  { prefix: '/auth/forgot-password',  tier: 'public', note: 'Forgot-password page — unauthenticated users only' },
  { prefix: '/auth/reset-password',   tier: 'public', note: 'Reset-password page — unauthenticated users only' },
  { prefix: '/auth/setup-password',   tier: 'public', note: 'First-time password setup for existing members' },
  { prefix: '/auth/complete',         tier: 'public', note: 'NextAuth→mmr_session bridge — called after OAuth/Credentials sign-in' },
]

/**
 * Returns the access tier required for a given pathname.
 * First matching prefix wins; unmatched paths are 'public'.
 */
export function getRequiredTier(pathname: string): AccessTier {
  const rule = ACCESS_CONFIG.find(r => pathname.startsWith(r.prefix))
  return rule?.tier ?? 'public'
}
