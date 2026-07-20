import { NextResponse } from 'next/server'
import { requireActiveMember } from '@/lib/auth/session'
import { toggleFavorite } from '@/lib/db/photos'
import { withApiHandler } from '@/lib/api-handler'

export const POST = withApiHandler(async (
  _req: Request,
  { params }: { params: { photoId: string } }
) => {
  const session   = await requireActiveMember()
  const favorited = await toggleFavorite(session.memberId, params.photoId)
  return NextResponse.json({ ok: true, data: { favorited } })
})
