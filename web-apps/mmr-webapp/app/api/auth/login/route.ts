import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requestEmailOtp } from '@/lib/auth/otp'
import { findMemberByEmail } from '@/lib/db/members'

const schema = z.object({ email: z.string().email() })

export async function POST(req: NextRequest) {
  try {
    const body  = await req.json()
    const { email } = schema.parse(body)

    const member = await findMemberByEmail(email)

    // Always send OTP regardless of whether member exists —
    // prevents email enumeration attacks.
    await requestEmailOtp(email)

    return NextResponse.json({
      ok: true,
      isNewMember: !member,
    })
  } catch (err: any) {
    if (err.name === 'ZodError') {
      return NextResponse.json({ ok: false, error: 'Invalid email.' }, { status: 400 })
    }
    console.error('[POST /api/auth/login]', err)
    return NextResponse.json({ ok: false, error: 'Failed to send code.' }, { status: 500 })
  }
}
