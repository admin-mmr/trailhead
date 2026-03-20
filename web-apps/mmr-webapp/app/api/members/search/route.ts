import { NextRequest, NextResponse } from 'next/server'
import { requireSession } from '@/lib/auth/session'
import { searchMembers } from '@/lib/db/photos'

// GET /api/members/search?q=<query>&limit=<n>
// Searches active members by MemberID, FirstName, or LastName.
// Used by friend-lookup and detection tag suggestions.
export async function GET(req: NextRequest) {
  await requireSession()

  const { searchParams } = new URL(req.url)
  const q     = (searchParams.get('q') ?? '').trim()
  const limit = Math.min(Number(searchParams.get('limit') ?? '10'), 30)

  if (q.length < 2)
    return NextResponse.json({ ok: true, data: [] })

  const members = await searchMembers(q, limit)
  return NextResponse.json({ ok: true, data: members })
}
