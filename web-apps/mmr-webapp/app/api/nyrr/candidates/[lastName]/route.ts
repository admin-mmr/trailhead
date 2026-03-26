import { NextRequest, NextResponse } from 'next/server'
import { requireSession } from '@/lib/auth/session'
import { isAdmin } from '@/lib/db/admins'
import db from '@/lib/db/connection'

export const dynamic = 'force-dynamic'

/**
 * GET /api/nyrr/candidates/[lastName]
 *
 * Member candidates for annotation UI.
 * Search members WHERE LastName = ? (case insensitive).
 * Returns: MemberID, FirstName, LastName, Email, YearBorn, Status, Gender, NYRRRunnerName
 */
export async function GET(
  req: NextRequest,
  { params }: { params: { lastName: string } }
) {
  try {
    const session = await requireSession()
    if (!(await isAdmin(session.email))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

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
  } catch (err: any) {
    if (err.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('[api/nyrr/candidates/[lastName]] GET error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
