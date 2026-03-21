import { NextResponse } from 'next/server'
import { requireActiveMember } from '@/lib/auth/session'
import { getMemberReferencePhotos } from '@/lib/db/photos'

// GET /api/photos/references
// Returns the authenticated member's active reference photos (with freshness flag).
export async function GET() {
  const session = await requireActiveMember()
  const refs = await getMemberReferencePhotos(session.memberId)
  return NextResponse.json({ ok: true, data: refs })
}
