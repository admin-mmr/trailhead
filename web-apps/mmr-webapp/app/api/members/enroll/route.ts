import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { findOrCreateMember } from '@/lib/db/members'
import { syncMemberToSheets } from '@/lib/sheets/sync'

// ── Validation schema ───────────────────────────────────────────────────────
const EnrollSchema = z.object({
  plan:           z.enum(['individual', 'family', 'family_upgrade']),
  firstName:      z.string().min(1),
  lastName:       z.string().min(1),
  email:          z.string().email(),
  phone:          z.string().min(7),
  wechatId:       z.string().optional(),
  district:       z.string().optional(),
  gender:         z.string().optional(),
  yearBorn:       z.preprocess(
    (val) => (val === '' || val === undefined || val === null) ? undefined : Number(val),
    z.number().int().optional(),
  ),
  nyrrRunnerName: z.string().optional(),
})

// ── POST /api/members/enroll ────────────────────────────────────────────────
// Called after Step 2 (info form) to save member to MySQL + Google Sheets
// and return an assigned MemberID for the payment memo.
export async function POST(req: NextRequest) {
  try {
    const body   = await req.json()
    const parsed = EnrollSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid input', details: parsed.error.flatten() },
        { status: 400 }
      )
    }

    const d = parsed.data
    const membershipType = d.plan === 'family' || d.plan === 'family_upgrade' ? 'family' : 'individual'

    // Find or create member (updates existing member info if email already exists)
    const member = await findOrCreateMember({
      email:          d.email,
      firstName:      d.firstName,
      lastName:       d.lastName,
      phone:          d.phone,
      wechatId:       d.wechatId,
      district:       d.district,
      gender:         d.gender,
      yearBorn:       d.yearBorn,
      nyrrRunnerName: d.nyrrRunnerName,
      membershipType,
    })

    // Sync to Google Sheets (non-fatal if it fails)
    try {
      await syncMemberToSheets(member)
    } catch (sheetErr) {
      console.error('[members/enroll] Google Sheets sync failed:', sheetErr)
    }

    return NextResponse.json({
      ok: true,
      memberId: member.memberId,
      isExisting: !!member.createdAt && new Date(member.createdAt).getTime() < Date.now() - 5000,
    }, { status: 200 })
  } catch (err: any) {
    console.error('[members/enroll] Error:', err)
    return NextResponse.json({ error: 'Enrollment failed. Please try again.' }, { status: 500 })
  }
}
