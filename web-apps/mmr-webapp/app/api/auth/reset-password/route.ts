import { NextRequest, NextResponse }  from 'next/server'
import { z }                          from 'zod'
import crypto                         from 'crypto'
import { getDb }                      from '@/lib/db/connection'
import { findMemberByEmail,
         setMemberPassword }          from '@/lib/db/members'
import { hashPassword }               from '@/lib/auth/password'

const schema = z.object({
  token:    z.string().min(1),
  password: z.string().min(8),
})

export async function POST(req: NextRequest) {
  try {
    const { token, password } = schema.parse(await req.json())

    const tokenHash = crypto.createHash('sha256').update(token).digest('hex')
    const db        = getDb()

    // ── Look up the token ───────────────────────────────────────────────────
    // DB column names are PascalCase (from v1 migration: TokenID, Email, ExpiresAt, Used).
    // Use AS aliases so result row keys are consistent snake_case.
    const [rows] = await db.execute<any[]>(
      `SELECT TokenID   AS token_id,
              Email     AS email,
              ExpiresAt AS expires_at,
              Used      AS used
       FROM password_reset_tokens
       WHERE TokenHash = ?
       LIMIT 1`,
      [tokenHash],
    )

    const row = rows[0]

    if (!row)        return NextResponse.json({ ok: false, error: 'Invalid or expired link.'            }, { status: 400 })
    if (row.used)    return NextResponse.json({ ok: false, error: 'This link has already been used.'   }, { status: 400 })
    if (new Date(row.expires_at) < new Date()) {
                     return NextResponse.json({ ok: false, error: 'This link has expired. Please request a new one.' }, { status: 400 })
    }

    const member = await findMemberByEmail(row.email)
    if (!member) return NextResponse.json({ ok: false, error: 'Account not found.' }, { status: 404 })

    // ── Hash and store the new password ────────────────────────────────────
    const hash = await hashPassword(password)
    await setMemberPassword(member.memberId, hash)

    // ── Mark token as used ─────────────────────────────────────────────────
    await db.execute(
      `UPDATE password_reset_tokens SET Used = 1 WHERE TokenID = ?`,
      [row.token_id],
    )

    return NextResponse.json({ ok: true })
  } catch (err: any) {
    if (err?.name === 'ZodError') {
      return NextResponse.json({ ok: false, error: 'Invalid input.' }, { status: 400 })
    }
    console.error('[POST /api/auth/reset-password]', err)
    return NextResponse.json({ ok: false, error: 'Reset failed.' }, { status: 500 })
  }
}
