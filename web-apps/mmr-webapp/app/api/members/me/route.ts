import { NextRequest, NextResponse } from 'next/server'
import { requireSession } from '@/lib/auth/session'
import { getMemberById, updateMemberProfile } from '@/lib/db/members'
import { z } from 'zod'

export async function GET() {
  try {
    const session = await requireSession()
    const member  = await getMemberById(session.memberId)
    if (!member) return NextResponse.json({ ok: false, error: 'Not found' }, { status: 404 })
    return NextResponse.json({ ok: true, data: member })
  } catch {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  }
}

const patchSchema = z.object({
  firstName:      z.string().optional(),
  lastName:       z.string().optional(),
  phone:          z.string().optional(),
  wechatId:       z.string().optional(),
  district:       z.string().optional(),
  gender:         z.string().optional(),
  yearBorn:       z.number().int().min(1900).max(new Date().getFullYear()).optional(),
  nyrrRunnerName: z.string().optional(),
  // Roster privacy opt-out (V037). false = counted on event rosters but not named.
  showRsvpPublicly: z.boolean().optional(),
})

export async function PATCH(req: NextRequest) {
  try {
    const session = await requireSession()
    const body    = await req.json()
    const updates = patchSchema.parse(body)
    await updateMemberProfile(session.memberId, updates)
    return NextResponse.json({ ok: true })
  } catch (err: any) {
    if (err.message === 'Unauthorized')
      return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
    return NextResponse.json({ ok: false, error: 'Update failed' }, { status: 500 })
  }
}
