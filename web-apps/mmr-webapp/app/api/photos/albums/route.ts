import { NextResponse } from 'next/server'
import { requireActiveMember } from '@/lib/auth/session'
import { getAllPhotoEvents } from '@/lib/db/photos'
import { withApiHandler } from '@/lib/api-handler'

export const GET = withApiHandler(async () => {
  await requireActiveMember()
  const events = await getAllPhotoEvents()
  return NextResponse.json({ ok: true, data: events })
})
