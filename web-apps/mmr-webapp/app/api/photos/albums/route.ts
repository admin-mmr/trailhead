import { NextResponse } from 'next/server'
import { requireActiveMember } from '@/lib/auth/session'
import { getAllPhotoEvents } from '@/lib/db/photos'

export async function GET() {
  await requireActiveMember()
  const events = await getAllPhotoEvents()
  return NextResponse.json({ ok: true, data: events })
}
