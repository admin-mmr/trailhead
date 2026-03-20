import { NextRequest, NextResponse } from 'next/server'
import { requireSession } from '@/lib/auth/session'
import { removeReferencePhoto } from '@/lib/db/photos'

// DELETE /api/photos/references/[id]
// Soft-deactivates a reference photo owned by the authenticated member.
export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await requireSession()
  const refId   = Number(params.id)

  if (!Number.isInteger(refId) || refId <= 0)
    return NextResponse.json({ ok: false, error: 'Invalid id' }, { status: 400 })

  await removeReferencePhoto(session.memberId, refId)
  return NextResponse.json({ ok: true })
}
