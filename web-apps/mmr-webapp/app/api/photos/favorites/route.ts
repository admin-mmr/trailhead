import { NextRequest, NextResponse } from 'next/server'
import { requireActiveMember } from '@/lib/auth/session'
import { getFavoritePhotos } from '@/lib/db/photos'

export async function GET(req: NextRequest) {
  const session  = await requireActiveMember()
  const page     = Number(req.nextUrl.searchParams.get('page') ?? 1)
  const pageSize = Number(req.nextUrl.searchParams.get('pageSize') ?? 40)
  const photos   = await getFavoritePhotos(session.memberId, page, pageSize)
  return NextResponse.json({ ok: true, data: photos })
}
