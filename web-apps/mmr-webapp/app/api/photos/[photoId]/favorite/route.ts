import { NextResponse } from 'next/server'
import { requireActiveMember } from '@/lib/auth/session'
import { toggleFavorite } from '@/lib/db/photos'

export async function POST(
  _req: Request,
  { params }: { params: { photoId: string } }
) {
  const session   = await requireActiveMember()
  const favorited = await toggleFavorite(session.memberId, params.photoId)
  return NextResponse.json({ ok: true, data: { favorited } })
}
