import { NextRequest, NextResponse } from 'next/server'
import { requireActiveMember } from '@/lib/auth/session'
import { getPhotosByEvent } from '@/lib/db/photos'
import { withApiHandler } from '@/lib/api-handler'

export const GET = withApiHandler(async (
  req: NextRequest,
  { params }: { params: { eventId: string } }
) => {
  const session  = await requireActiveMember()
  const page     = Number(req.nextUrl.searchParams.get('page') ?? 1)
  const pageSize = Number(req.nextUrl.searchParams.get('pageSize') ?? 40)
  const photos   = await getPhotosByEvent(params.eventId, session.memberId, page, pageSize)
  return NextResponse.json({ ok: true, data: photos })
})
