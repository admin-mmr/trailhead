import { NextRequest, NextResponse } from 'next/server'
import { requireActiveMember } from '@/lib/auth/session'
import { upsertFeedback } from '@/lib/db/photos'

// POST /api/photos/[photoId]/feedback
// Body: { rating?: number (1-5), story?: string }
export async function POST(
  req: NextRequest,
  { params }: { params: { photoId: string } }
) {
  const session = await requireActiveMember()
  const body    = await req.json()

  const rating = typeof body.rating === 'number' ? Math.min(5, Math.max(1, body.rating)) : undefined
  const story  = typeof body.story  === 'string' ? body.story.slice(0, 2000) : undefined

  if (rating === undefined && story === undefined)
    return NextResponse.json({ ok: false, error: 'Provide rating or story' }, { status: 400 })

  await upsertFeedback(session.memberId, params.photoId, rating, story)
  return NextResponse.json({ ok: true })
}
