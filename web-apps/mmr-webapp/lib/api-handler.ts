// ============================================================
// lib/api-handler.ts — Shared API route error wrapper
//
// Wraps an App Router route handler so that thrown errors carrying
// a `status` property (e.g. from requireActiveMember / requireSession
// in lib/auth/session.ts) become proper JSON error responses instead
// of unhandled 500s.
//
//   401/403/etc  → { ok: false, error: err.message } with that status
//   anything else → { ok: false, error: 'Internal server error' } (500),
//                   with the real error logged server-side only.
//
// Usage:
//   export const GET = withApiHandler(async (req) => { ... })
// ============================================================

import { NextResponse } from 'next/server'
import { trackException } from '@/lib/telemetry'

/** Error shape thrown by session guards: `err.status` set to an HTTP code. */
interface HttpError {
  status?: unknown
  message?: unknown
}

/**
 * Pathname of a request URL, or 'unknown'.
 * Never the full URL — query strings can carry member identifiers, and
 * telemetry is retained far longer than a request log.
 */
function safePath(url: unknown): string {
  if (typeof url !== 'string') return 'unknown'
  try {
    return new URL(url).pathname
  } catch {
    return 'unknown'
  }
}

function isClientHttpStatus(status: unknown): status is number {
  return typeof status === 'number' && Number.isInteger(status) && status >= 400 && status <= 499
}

/**
 * Higher-order wrapper for App Router route handlers.
 * Preserves the handler's exact signature (request, context params, …).
 */
export function withApiHandler<Args extends unknown[]>(
  handler: (...args: Args) => Response | Promise<Response>
): (...args: Args) => Promise<Response> {
  return async (...args: Args): Promise<Response> => {
    try {
      return await handler(...args)
    } catch (err) {
      const { status, message } = (err ?? {}) as HttpError
      if (isClientHttpStatus(status)) {
        const error = typeof message === 'string' && message ? message : 'Request failed'
        return NextResponse.json({ ok: false, error }, { status })
      }
      console.error('[api-handler] unhandled error:', err)
      // Report to Application Insights as well as the console. console.error
      // alone is invisible on Azure SWA, which is why the 07-30 login
      // investigation had no server logs to read. Deliberately not awaited:
      // the 500 should not wait on telemetry, and trackException never throws.
      const req = args[0] as { method?: string; url?: string } | undefined
      void trackException(err, {
        source: 'api-handler',
        method: typeof req?.method === 'string' ? req.method : 'unknown',
        // pathname only — a full URL can carry query-string parameters
        path: safePath(req?.url),
      })
      return NextResponse.json({ ok: false, error: 'Internal server error' }, { status: 500 })
    }
  }
}
