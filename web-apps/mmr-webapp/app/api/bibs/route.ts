import { NextRequest, NextResponse } from 'next/server'
import { requireSession } from '@/lib/auth/session'
import { getMemberBibAssignments, upsertBibAssignment } from '@/lib/db/photos'

// GET /api/bibs
// Returns the authenticated member's bib assignments across all events.
export async function GET() {
  const session = await requireSession()
  const bibs    = await getMemberBibAssignments(session.memberId)
  return NextResponse.json({ ok: true, data: bibs })
}

// POST /api/bibs
// Body: { eventId: string, bibNumber: string }
// Member self-assigns a bib number for an event.
export async function POST(req: NextRequest) {
  const session = await requireSession()
  const body    = await req.json()

  const { eventId, bibNumber } = body
  if (!eventId || !bibNumber || typeof eventId !== 'string' || typeof bibNumber !== 'string')
    return NextResponse.json({ ok: false, error: 'eventId and bibNumber required' }, { status: 400 })

  const cleanBib = bibNumber.trim().replace(/\D/g, '')   // digits only
  if (!cleanBib)
    return NextResponse.json({ ok: false, error: 'Invalid bib number' }, { status: 400 })

  await upsertBibAssignment(session.memberId, eventId, cleanBib, 'member_self')
  return NextResponse.json({ ok: true })
}
