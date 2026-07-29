import { NextRequest, NextResponse } from 'next/server'
import { requireActiveMember } from '@/lib/auth/session'
import { withApiHandler } from '@/lib/api-handler'
import { getCalendarEvents, getLatestKnownEventDate } from '@/lib/db/events'
import { resolveRange } from '@/lib/events-range'

export const dynamic = 'force-dynamic'

/**
 * GET /api/events/calendar?from=YYYY-MM-DD&to=YYYY-MM-DD
 *
 * NYRR events in the requested window, annotated with the caller's own RSVP and
 * per-intent counts. Active members only — the roster counts are member data.
 *
 * Both params are optional; missing or malformed values fall back to the default
 * window (one month back → three months forward). The span is clamped server-side
 * (see lib/events-range.ts), and `clamped: true` comes back when that happened.
 *
 * `latestKnownEventDate` is included so the client can explain an empty or short
 * calendar honestly — NYRR publishes only ~8 weeks ahead, so "no races past X"
 * is the normal state, not a failure.
 */
export const GET = withApiHandler(async (req: NextRequest) => {
  const session = await requireActiveMember()

  const { from, to, clamped } = resolveRange(
    req.nextUrl.searchParams.get('from'),
    req.nextUrl.searchParams.get('to')
  )

  const [events, latestKnownEventDate] = await Promise.all([
    getCalendarEvents(session.memberId, from, to),
    getLatestKnownEventDate(),
  ])

  return NextResponse.json({
    ok: true,
    data: { from, to, clamped, latestKnownEventDate, events },
  })
})
