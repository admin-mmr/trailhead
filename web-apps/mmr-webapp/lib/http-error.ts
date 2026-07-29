// ============================================================
// lib/http-error.ts — Status-carrying Error for API guards
//
// Dependency-free on purpose: session guards (which also run in middleware /
// edge) and route handlers both need this, so it must not pull in next/server
// the way lib/api-handler.ts does. withApiHandler maps `err.status` (4xx) to a
// JSON response; anything else becomes a logged 500.
// ============================================================

/** Builds an Error carrying an HTTP status for withApiHandler to map. */
export function httpError(status: number, message: string): Error & { status: number } {
  const err = new Error(message) as Error & { status: number }
  err.status = status
  return err
}
