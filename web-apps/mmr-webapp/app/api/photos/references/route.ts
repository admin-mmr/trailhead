import { NextResponse } from 'next/server'
import { requireActiveMember } from '@/lib/auth/session'
import { getMemberReferencePhotos } from '@/lib/db/photos'
import { withApiHandler } from '@/lib/api-handler'

// GET /api/photos/references
// Returns the authenticated member's active reference photos (with freshness flag).
export const GET = withApiHandler(async () => {
  const session = await requireActiveMember()
  const refs = await getMemberReferencePhotos(session.memberId)
  return NextResponse.json({ ok: true, data: refs })
})
