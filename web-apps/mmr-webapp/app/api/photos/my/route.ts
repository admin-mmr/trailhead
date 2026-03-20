import { NextRequest, NextResponse } from 'next/server'
import { requireSession } from '@/lib/auth/session'
import { getPhotosByMember } from '@/lib/db/photos'

// GET /api/photos/my                     → logged-in member's photos
// GET /api/photos/my?memberId=A0042      → any member's photos (friend lookup)
export async function GET(req: NextRequest) {
  const session  = await requireSession()
  const targetId = req.nextUrl.searchParams.get('memberId') ?? session.memberId
  const page     = Number(req.nextUrl.searchParams.get('page') ?? 1)
  const pageSize = Number(req.nextUrl.searchParams.get('pageSize') ?? 40)
  const photos   = await getPhotosByMember(targetId, session.memberId, page, pageSize)
  return NextResponse.json({ ok: true, data: photos })
}
