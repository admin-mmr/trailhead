import { NextRequest, NextResponse } from 'next/server'
import { requireActiveMember } from '@/lib/auth/session'
import pool from '@/lib/db/connection'
import { withApiHandler } from '@/lib/api-handler'

// DELETE /api/bibs/[id]
// Removes a bib assignment (only member_self entries owned by the caller).
export const DELETE = withApiHandler(async (
  _req: NextRequest,
  { params }: { params: { id: string } }
) => {
  const session = await requireActiveMember()
  const bibId   = Number(params.id)

  if (!Number.isInteger(bibId) || bibId <= 0)
    return NextResponse.json({ ok: false, error: 'Invalid id' }, { status: 400 })

  // Only allow deleting own self-assigned bibs (not nyrr_auto or admin_import)
  const [result] = await pool.query<any>(
    `DELETE FROM member_bib_assignments
     WHERE id = ? AND member_id = ? AND source = 'member_self'`,
    [bibId, session.memberId]
  )

  if (result.affectedRows === 0)
    return NextResponse.json(
      { ok: false, error: 'Assignment not found or cannot be deleted' },
      { status: 404 }
    )

  return NextResponse.json({ ok: true })
})
