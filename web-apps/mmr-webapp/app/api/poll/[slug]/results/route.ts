// GET /api/poll/[slug]/results — the tally, subject to the poll's visibility rule.
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { withApiHandler } from '@/lib/api-handler'
import { getPollBySlug, getPollResults } from '@/lib/db/polls'
import { votedCookieName } from '@/lib/poll-shared'

export const dynamic = 'force-dynamic'

export const GET = withApiHandler(async (
  _req: Request,
  { params }: { params: { slug: string } }
) => {
  const poll = await getPollBySlug(params.slug)
  if (!poll || poll.status === 'draft') {
    return NextResponse.json({ ok: false, error: 'Poll not found' }, { status: 404 })
  }

  // 'admin' visibility is enforced by lib/access.ts routing this path through
  // the admin gate; this route only handles the public two.
  if (poll.resultsVisibility === 'after_vote' && poll.status === 'open') {
    const voted = cookies().get(votedCookieName(poll.slug))?.value === '1'
    if (!voted) {
      return NextResponse.json(
        { ok: false, error: 'Results are shown once you have voted.', locked: true },
        { status: 403 }
      )
    }
  }

  const results = await getPollResults(poll.id)
  return NextResponse.json({
    ok: true,
    poll: { slug: poll.slug, titleEn: poll.titleEn, titleZh: poll.titleZh, mode: poll.mode, status: poll.status },
    results,
  })
})
