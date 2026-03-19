import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { findMemberByEmail, createNewMember } from '@/lib/db/members'

const schema = z.object({
  email:          z.string().email(),
  englishName:    z.string().min(1),
  chineseName:    z.string().optional(),
  phone:          z.string().optional(),
  wechatId:       z.string().optional(),
  membershipType: z.enum(['individual', 'family']),
})

export async function POST(req: NextRequest) {
  try {
    const body   = await req.json()
    const params = schema.parse(body)

    // Return existing member if already registered (idempotent)
    const existing = await findMemberByEmail(params.email)
    if (existing) {
      return NextResponse.json({ ok: true, data: existing })
    }

    const member = await createNewMember(params)
    return NextResponse.json({ ok: true, data: member }, { status: 201 })
  } catch (err: any) {
    if (err.name === 'ZodError') {
      return NextResponse.json({ ok: false, error: 'Invalid input.' }, { status: 400 })
    }
    console.error('[POST /api/members/register]', err)
    return NextResponse.json({ ok: false, error: 'Registration failed.' }, { status: 500 })
  }
}
