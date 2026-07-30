import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireActiveMember } from '@/lib/auth/session'
import { withApiHandler } from '@/lib/api-handler'
import { httpError } from '@/lib/http-error'
import { getMemberById, updateMemberProfile } from '@/lib/db/members'
import { findRunnerCandidates } from '@/lib/db/nyrr-results'

export const dynamic = 'force-dynamic'

/** Oldest plausible living runner; upper bound is "old enough to have raced". */
const MIN_YEAR_BORN = 1900

// Not exported: Next.js rejects any non-Route export from a route file, and the
// build is the only thing that catches it (tsc --noEmit passes).
const linkSchema = z.object({
  // NYRRRunnerName is varchar(100); require a real name, not a single letter.
  nyrrRunnerName: z.string().trim().min(2).max(100),
  yearBorn: z.number().int().min(MIN_YEAR_BORN).max(new Date().getFullYear() - 5),
})

/**
 * POST /api/members/me/nyrr-link   body: { nyrrRunnerName, yearBorn }
 *
 * Saves the two fields on the member record, then returns CANDIDATE runner rows
 * for the member to confirm. It deliberately does NOT write mmr_member_id: a
 * wrong link poisons NYRRRunnerName, which then makes the admin's Tier-1 matcher
 * confidently recreate the bad match. Confirmation happens in
 * POST /api/members/me/nyrr-link/confirm.
 */
export const POST = withApiHandler(async (req: NextRequest) => {
  const session = await requireActiveMember()

  let body: unknown
  try {
    body = await req.json()
  } catch {
    throw httpError(400, 'Invalid JSON body')
  }

  const parsed = linkSchema.safeParse(body)
  if (!parsed.success) {
    throw httpError(400, 'Provide your NYRR name (2-100 characters) and a valid birth year')
  }

  const { nyrrRunnerName, yearBorn } = parsed.data
  await updateMemberProfile(session.memberId, { nyrrRunnerName, yearBorn })

  const member = await getMemberById(session.memberId)
  const candidates = await findRunnerCandidates(session.memberId, {
    nyrrRunnerName,
    yearBorn,
    memberGender: member?.gender ?? null,
  })

  return NextResponse.json({
    ok: true,
    data: { saved: { nyrrRunnerName, yearBorn }, candidates },
  })
})
