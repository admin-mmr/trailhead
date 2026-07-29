// ============================================================
// lib/auth/admin.ts — Admin guard for API route handlers
//
// Composes requireSession() with the DB admin lookup so admin-only routes
// don't each hand-roll the same session + isAdmin + 403 boilerplate.
// Throws status-carrying errors that withApiHandler maps to 401/403.
// ============================================================

import { requireSession } from '@/lib/auth/session'
import { httpError } from '@/lib/http-error'
import { isAdmin } from '@/lib/db/admins'
import type { SessionUser } from '@/types'

/**
 * Requires a logged-in member who is also an admin.
 *   no session  → throws 401 Unauthorized
 *   not admin   → throws 403 Forbidden
 */
export async function requireAdmin(): Promise<SessionUser> {
  const session = await requireSession()
  if (!(await isAdmin(session.email))) throw httpError(403, 'Forbidden')
  return session
}
