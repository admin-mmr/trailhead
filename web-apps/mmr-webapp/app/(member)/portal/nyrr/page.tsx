// ─────────────────────────────────────────────────────────────────────────────
// /portal/nyrr — My NYRR Results
//
// Data comes from GET /api/members/me/nyrr-results (active-member tier — note the
// '/api/members/me/nyrr' rule sits ABOVE the looser '/api/members/me' rule in
// lib/access.ts, since first prefix match wins).
//
// With no linked results the client shows the self-service link form instead
// (NYRR name + birth year → confirm candidates), rather than an empty dashboard.
// ─────────────────────────────────────────────────────────────────────────────

import NyrrResultsClient from './NyrrResultsClient'

export const metadata = {
  title: 'NYRR Results | MMR Member Portal',
}

export default function NyrrPage() {
  return <NyrrResultsClient />
}
