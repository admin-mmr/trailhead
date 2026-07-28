import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/auth/admin'
import { withApiHandler } from '@/lib/api-handler'
import db from '@/lib/db/connection'

export const dynamic = 'force-dynamic'

/**
 * GET /api/nyrr/candidates/[lastName]
 *
 * Member candidates for annotation UI.
 * Search members WHERE LastName = ? (case insensitive).
 * Returns: MemberID, FirstName, LastName, Email, YearBorn, Status, Gender, NYRRRunnerName
 */
export const GET = withApiHandler(async (
  req: NextRequest,
  { params }: { params: { lastName: string } }
) => {
  await requireAdmin()

  const lastName = params.lastName
  if (!lastName || typeof lastName !== 'string' || lastName.length === 0) {
    return NextResponse.json(
      { error: 'Last name is required' },
      { status: 400 }
    )
  }

  const [rows] = (await db.execute(
    `SELECT
      MemberID,
      FirstName,
      LastName,
      Email,
      YearBorn,
      Status,
      Gender,
      NYRRRunnerName
     FROM members
     WHERE LOWER(LastName) = LOWER(?)
     ORDER BY FirstName ASC`,
    [lastName]
  )) as [any[], any]

  return NextResponse.json({
    ok: true,
    data: rows || [],
  })
})
