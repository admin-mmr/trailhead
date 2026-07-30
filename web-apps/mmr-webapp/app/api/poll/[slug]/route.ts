// GET /api/poll/[slug] — the poll and its options. Public, no login.
import { NextResponse } from 'next/server'
import { withApiHandler } from '@/lib/api-handler'
import { getPollBySlug } from '@/lib/db/polls'

export const dynamic = 'force-dynamic'

export const GET = withApiHandler(async (
  _req: Request,
  { params }: { params: { slug: string } }
) => {
  const poll = await getPollBySlug(params.slug)
  if (!poll || poll.status === 'draft') {
    return NextResponse.json({ ok: false, error: 'Poll not found' }, { status: 404 })
  }
  return NextResponse.json({ ok: true, poll })
})
