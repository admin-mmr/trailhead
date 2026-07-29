import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireActiveMember } from '@/lib/auth/session'
import { withApiHandler } from '@/lib/api-handler'
import { httpError } from '@/lib/http-error'
import { RSVP_INTENTS, deleteRsvp, getEventDate, upsertRsvp } from '@/lib/db/events'
import { todayNY } from '@/lib/events-range'

export const dynamic = 'force-dynamic'

const rsvpSchema = z.object({
  intent: z.enum(['running', 'volunteering', 'interested', 'not_going']),
  // 280 matches the note column in V037; trailing whitespace is trimmed away and
  // an empty note is stored as NULL rather than ''.
  note: z.string().trim().max(280).optional(),
})

/** Shared param parsing: the id must be a positive integer, not "abc" or "-1". */
async function parseEventId(ctx: { params: Promise<{ id: string }> }): Promise<number> {
  const { id } = await ctx.params
  const eventId = Number(id)
  if (!Number.isInteger(eventId) || eventId <= 0) throw httpError(400, 'Invalid event id')
  return eventId
}

/**
 * POST /api/events/[id]/rsvp   body: { intent, note? }
 *
 * Records or changes the caller's own RSVP. Idempotent — the V037 unique key
 * makes a repeat an UPDATE, so a double-tapped button cannot create two rows.
 *
 * The member is always taken from the session: there is deliberately no way to
 * RSVP on someone else's behalf through this route.
 */
export const POST = withApiHandler(
  async (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
    const session = await requireActiveMember()
    const eventId = await parseEventId(ctx)

    let body: unknown
    try {
      body = await req.json()
    } catch {
      throw httpError(400, 'Invalid JSON body')
    }

    const parsed = rsvpSchema.safeParse(body)
    if (!parsed.success) {
      throw httpError(400, `intent must be one of: ${RSVP_INTENTS.join(', ')}`)
    }

    // Check the event exists before writing — otherwise the FK raises and
    // withApiHandler would turn a bad id into an opaque 500.
    const eventDate = await getEventDate(eventId)
    if (!eventDate) throw httpError(404, 'Event not found')

    // Race day itself is still open; anything earlier is history.
    if (eventDate < todayNY()) {
      throw httpError(409, 'That race has already happened')
    }

    const note = parsed.data.note && parsed.data.note.length ? parsed.data.note : null
    await upsertRsvp(eventId, session.memberId, parsed.data.intent, note)

    return NextResponse.json({ ok: true, data: { intent: parsed.data.intent, note } })
  }
)

/**
 * DELETE /api/events/[id]/rsvp — clears the caller's RSVP.
 *
 * Idempotent: clearing an RSVP that isn't there is a success, not a 404. The
 * caller's intended end state ("I have no RSVP") is what matters.
 */
export const DELETE = withApiHandler(
  async (_req: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
    const session = await requireActiveMember()
    const eventId = await parseEventId(ctx)

    const removed = await deleteRsvp(eventId, session.memberId)
    return NextResponse.json({ ok: true, data: { removed } })
  }
)
