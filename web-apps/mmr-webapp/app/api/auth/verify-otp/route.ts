import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { verifyEmailOtp } from '@/lib/auth/otp'
import { findMemberByEmail } from '@/lib/db/members'
import { createSession, setSessionCookie } from '@/lib/auth/session'

const schema = z.object({
  email: z.string().email(),
  code:  z.string().length(6),
})

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { email, code } = schema.parse(body)

    const valid = await verifyEmailOtp(email, code)
    if (!valid) {
      return NextResponse.json({ ok: false, error: 'Invalid or expired code.' }, { status: 401 })
    }

    const member = await findMemberByEmail(email)
    if (!member) {
      // No account yet — redirect to join page
      return NextResponse.json({ ok: true, redirect: '/join' })
    }

    const token = await createSession({
      memberId:    member.memberId,
      email:       member.email,
      englishName: member.englishName,
      chineseName: member.chineseName,
      status:      member.status,
    })

    const res = NextResponse.json({ ok: true, redirect: '/portal' })
    res.cookies.set(setSessionCookie(token))
    return res
  } catch (err: any) {
    if (err.name === 'ZodError') {
      return NextResponse.json({ ok: false, error: 'Invalid input.' }, { status: 400 })
    }
    console.error('[POST /api/auth/verify-otp]', err)
    return NextResponse.json({ ok: false, error: 'Verification failed.' }, { status: 500 })
  }
}
