import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireActiveMember } from '@/lib/auth/session'
import { withApiHandler } from '@/lib/api-handler'
import { httpError } from '@/lib/http-error'
import { getMemberById } from '@/lib/db/members'
import { MAX_CANDIDATES, confirmRunnerLinks } from '@/lib/db/nyrr-results'

export const dynamic = 'force-dynamic'

const confirmSchema = z.object({
  runnerIds: z.array(z.number().int().positive()).min(1).max(MAX_CANDIDATES),
})

/**
 * POST /api/members/me/nyrr-link/confirm   body: { runnerIds: number[] }
 *
 * Links the chosen runner rows to the caller with match_method='manual' and
 * matched_by='member:<MemberID>', so the audit trail distinguishes self-service
 * links from admin ones and admins can still override in the match queue.
 *
 * `runnerIds` is untrusted input: confirmRunnerLinks() intersects it with a
 * freshly computed candidate set rather than writing the ids directly, so a
 * hand-crafted id for someone else's result cannot be claimed. The profile must
 * already carry NYRRRunnerName + YearBorn (set by the link step) — those are the
 * criteria the candidate set is derived from.
 */
export const POST = withApiHandler(async (req: NextRequest) => {
  const session = await requireActiveMember()

  let body: unknown
  try {
    body = await req.json()
  } catch {
    throw httpError(400, 'Invalid JSON body')
  }

  const parsed = confirmSchema.safeParse(body)
  if (!parsed.success) throw httpError(400, 'Select at least one result to link')

  const member = await getMemberById(session.memberId)
  if (!member?.nyrrRunnerName || member.yearBorn == null) {
    throw httpError(409, 'Save your NYRR name and birth year first')
  }

  const { linked } = await confirmRunnerLinks(session.memberId, parsed.data.runnerIds, {
    nyrrRunnerName: member.nyrrRunnerName,
    yearBorn: member.yearBorn,
    memberGender: member.gender ?? null,
  })

  // 0 linked means every id failed the server-side re-check — a stale candidate
  // list, or an id that was never eligible.
  return NextResponse.json({
    ok: true,
    data: { linked, requested: parsed.data.runnerIds.length },
  })
})
