/**
 * auth.ts — shared bearer-secret gate for machine-called routes.
 *
 * Used by the scheduled reminder job (GitHub Actions cron) and by the Flask
 * admin when it asks the webapp to send family notifications. These callers have
 * no member session, so they authenticate with a shared secret in
 * `Authorization: Bearer …` instead.
 *
 * Two rules worth keeping:
 *   • the comparison is constant-time. A plain `===` on a secret leaks its
 *     prefix through response timing, which is exactly the shape of attack a
 *     public endpoint invites.
 *   • a MISSING secret denies everything. Failing open would mean a
 *     misconfigured deploy silently exposes a route that can email 400 members.
 */

import { createHash, timingSafeEqual } from 'node:crypto'

export const JOB_SECRET_ENV = 'JOB_SECRET'

export type JobAuthResult =
  | { ok: true }
  | { ok: false; status: 401 | 503; message: string }

export function authorizeJobRequest(request: Request): JobAuthResult {
  const expected = process.env[JOB_SECRET_ENV]
  if (!expected) {
    // 503, not 401: the caller's credentials are not the problem, and a 401
    // would send someone hunting for a bad secret instead of a missing setting.
    return {
      ok: false,
      status: 503,
      message: `${JOB_SECRET_ENV} is not configured on this deployment`,
    }
  }

  const header = request.headers.get('authorization') ?? ''
  const match = /^Bearer\s+(.+)$/i.exec(header.trim())
  if (!match) {
    return { ok: false, status: 401, message: 'Missing bearer token' }
  }

  if (!secretsMatch(match[1], expected)) {
    return { ok: false, status: 401, message: 'Invalid token' }
  }
  return { ok: true }
}

function secretsMatch(provided: string, expected: string): boolean {
  // Compare SHA-256 digests rather than the raw strings: timingSafeEqual throws
  // when its arguments differ in length, and guarding that with an early return
  // would leak the secret's length. Digests are always 32 bytes.
  const a = createHash('sha256').update(provided, 'utf8').digest()
  const b = createHash('sha256').update(expected, 'utf8').digest()
  return timingSafeEqual(a, b)
}
