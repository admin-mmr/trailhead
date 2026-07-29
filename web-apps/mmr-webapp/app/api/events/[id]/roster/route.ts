import { NextRequest, NextResponse } from 'next/server'
import { requireActiveMember } from '@/lib/auth/session'
import { withApiHandler } from '@/lib/api-handler'
import { httpError } from '@/lib/http-error'
import { getEventDate, getEventRoster } from '@/lib/db/events'

export const dynamic = 'force-dynamic'

/**
 * GET /api/events/[id]/roster
 *
 * Who's running and who's volunteering, for one event. Active members only.
 *
 * Members who set ShowRsvpPublicly = 0 are counted but never named — that filter
 * lives in getEventRoster() so it can't be forgotten here. `hiddenCount` tells
 * the UI how many responders are counted-but-unnamed, so the numbers add up
 * without exposing who opted out.
 */
export const GET = withApiHandler(
  async (_req: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
    await requireActiveMember()

    const { id } = await ctx.params
    const eventId = Number(id)
    if (!Number.isInteger(eventId) || eventId <= 0) throw httpError(400, 'Invalid event id')

    if (!(await getEventDate(eventId))) throw httpError(404, 'Event not found')

    const roster = await getEventRoster(eventId)
    return NextResponse.json({ ok: true, data: roster })
  }
)
