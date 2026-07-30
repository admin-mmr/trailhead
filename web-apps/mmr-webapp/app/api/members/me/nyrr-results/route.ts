import { NextResponse } from 'next/server'
import { requireActiveMember } from '@/lib/auth/session'
import { withApiHandler } from '@/lib/api-handler'
import { getMemberById } from '@/lib/db/members'
import { getMemberResults } from '@/lib/db/nyrr-results'

export const dynamic = 'force-dynamic'

/**
 * GET /api/members/me/nyrr-results
 *
 * This member's linked NYRR results, newest first, plus whether they've supplied
 * the two fields the link form needs. `linked: false` with zero results is what
 * drives the UI to show the link form instead of an empty dashboard.
 *
 * Scoped to the session member — there is no id parameter, by design.
 */
export const GET = withApiHandler(async () => {
  const session = await requireActiveMember()

  const [member, results] = await Promise.all([
    getMemberById(session.memberId),
    getMemberResults(session.memberId),
  ])

  return NextResponse.json({
    ok: true,
    data: {
      results,
      linked: results.length > 0,
      profile: {
        nyrrRunnerName: member?.nyrrRunnerName ?? null,
        yearBorn: member?.yearBorn ?? null,
      },
    },
  })
})
