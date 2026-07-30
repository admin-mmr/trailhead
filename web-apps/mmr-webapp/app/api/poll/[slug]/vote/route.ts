// POST /api/poll/[slug]/vote — cast or replace a ballot. Public, no login:
// the voter identifies with MemberID + last name, checked against `members`.
import { createHash } from 'node:crypto'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { withApiHandler } from '@/lib/api-handler'
import { getPollBySlug, resolveVoter, castBallot, getPollResults, PollError } from '@/lib/db/polls'
import { MAX_COMMENT_LEN, votedCookieName } from '@/lib/poll-shared'

export const dynamic = 'force-dynamic'

const BodySchema = z.object({
  memberId: z.string().trim().min(1).max(10).optional(),
  lastName: z.string().trim().min(1).max(100).optional(),
  choices: z.array(z.string().trim().min(1).max(32)).min(1).max(3),
  comment: z.string().max(MAX_COMMENT_LEN).optional(),
})

/**
 * Salted hash of the caller IP, for spotting abuse patterns without keeping
 * the address. AUTH_SECRET is the salt so the hash is not reversible by
 * rainbow table; if it is unset the field is simply omitted.
 */
function hashIp(req: Request): string | null {
  const fwd = req.headers.get('x-forwarded-for') ?? ''
  const ip = fwd.split(',')[0]?.trim()
  const salt = process.env.AUTH_SECRET
  if (!ip || !salt) return null
  return createHash('sha256').update(`${salt}:${ip}`).digest('hex')
}

export const POST = withApiHandler(async (
  req: Request,
  { params }: { params: { slug: string } }
) => {
  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid request body' }, { status: 400 })
  }

  const parsed = BodySchema.safeParse(raw)
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: 'Invalid request body' }, { status: 400 })
  }
  const { memberId, lastName, choices, comment } = parsed.data

  const poll = await getPollBySlug(params.slug)
  if (!poll || poll.status === 'draft') {
    return NextResponse.json({ ok: false, error: 'Poll not found' }, { status: 404 })
  }

  try {
    // Identify the voter first: a closed poll or a malformed ballot should not
    // reveal whether a given member ID exists, and vice versa.
    let resolvedMemberId: string | null = null
    if (poll.voterCheck === 'member') {
      if (!memberId || !lastName) {
        return NextResponse.json(
          { ok: false, error: 'Enter both your member ID and your last name.' },
          { status: 400 }
        )
      }
      resolvedMemberId = await resolveVoter(memberId, lastName)
    }

    await castBallot({
      poll,
      memberId: resolvedMemberId,
      choiceCodes: choices,
      comment: comment ?? null,
      ipHash: hashIp(req),
    })

    // The voter has earned sight of the tally, so hand it back with the
    // confirmation rather than making the results page a second round trip.
    const results = poll.resultsVisibility === 'admin' ? null : await getPollResults(poll.id)

    const res = NextResponse.json({ ok: true, results })
    res.cookies.set(votedCookieName(poll.slug), '1', {
      httpOnly: false,          // the results page reads this client-side too
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: 60 * 60 * 24 * 180,
    })
    return res
  } catch (err) {
    if (err instanceof PollError) {
      return NextResponse.json({ ok: false, error: err.message }, { status: err.status })
    }
    throw err
  }
})
