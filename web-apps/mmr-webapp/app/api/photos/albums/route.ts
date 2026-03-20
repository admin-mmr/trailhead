import { NextResponse } from 'next/server'
import { requireSession } from '@/lib/auth/session'
import { getAllPhotoEvents } from '@/lib/db/photos'

export async function GET() {
  await requireSession()
  const events = await getAllPhotoEvents()
  return NextResponse.json({ ok: true, data: events })
}
