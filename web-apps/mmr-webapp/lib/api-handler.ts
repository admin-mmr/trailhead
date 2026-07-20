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

/** Error shape thrown by session guards: `err.status` set to an HTTP code. */
interface HttpError {
  status?: unknown
  message?: unknown
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
      return NextResponse.json({ ok: false, error: 'Internal server error' }, { status: 500 })
    }
  }
}
