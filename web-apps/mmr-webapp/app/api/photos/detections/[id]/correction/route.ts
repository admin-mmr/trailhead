import { NextRequest, NextResponse } from 'next/server'
import { requireActiveMember } from '@/lib/auth/session'
import { submitCorrection } from '@/lib/db/photos'
import { withApiHandler } from '@/lib/api-handler'

// POST /api/photos/detections/[id]/correction
// Body: { correctionType: 'wrong_person'|'correct_person'|'missing_person',
//         suggestedMemberId?: string, note?: string }
export const POST = withApiHandler(async (
  req: NextRequest,
  { params }: { params: { id: string } }
) => {
  const session = await requireActiveMember()
  const body    = await req.json()
  const { correctionType, suggestedMemberId, note } = body

  const validTypes = ['wrong_person', 'correct_person', 'missing_person']
  if (!validTypes.includes(correctionType))
    return NextResponse.json({ ok: false, error: 'Invalid correctionType' }, { status: 400 })

  await submitCorrection(
    Number(params.id),
    session.memberId,
    correctionType,
    suggestedMemberId,
    note
  )
  return NextResponse.json({ ok: true })
})
