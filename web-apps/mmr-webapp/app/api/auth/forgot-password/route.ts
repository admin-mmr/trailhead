import { NextRequest, NextResponse }     from 'next/server'
import { z }                             from 'zod'
import crypto                            from 'crypto'
import { getDb }                         from '@/lib/db/connection'
import { findMemberByEmail }             from '@/lib/db/members'
import { sendEmail }                     from '@/lib/email/client'
import { passwordResetEmailHtml }        from '@/lib/email/templates'

const EXPIRY_MINUTES = 60
const schema = z.object({ email: z.string().email() })

export async function POST(req: NextRequest) {
  try {
    const { email } = schema.parse(await req.json())

    // Always respond OK regardless of whether email exists (prevents enumeration)
    const member = await findMemberByEmail(email)
    if (!member) return NextResponse.json({ ok: true })

    // ── Generate token ──────────────────────────────────────────────────────
    // rawToken is sent in the email link. Only its SHA-256 hash is stored in DB.
    const rawToken  = crypto.randomBytes(32).toString('hex')
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex')
    const tokenId   = `PRT-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`
    const expiresAt = new Date(Date.now() + EXPIRY_MINUTES * 60 * 1000)

    const db = getDb()

    // Invalidate any existing active token for this email first
    // DB column names are PascalCase (from v1 migration)
    await db.execute(
      `UPDATE password_reset_tokens SET Used = 1 WHERE Email = ? AND Used = 0`,
      [email],
    )

    await db.execute(
      `INSERT INTO password_reset_tokens (TokenID, Email, TokenHash, ExpiresAt)
       VALUES (?, ?, ?, ?)`,
      [tokenId, email, tokenHash, expiresAt],
    )

    // ── Send email ──────────────────────────────────────────────────────────
    const appUrl   = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'
    const resetUrl = `${appUrl}/auth/reset-password?token=${rawToken}`

    // No cc — deliberately. This email carries a live reset-token link, so the
    // club's admin copy (see ADMIN_CC) must never be added here.
    await sendEmail({
      to:        email,
      subject:   'Reset your MMR password',
      html:      passwordResetEmailHtml({
        firstName:  member.firstName ?? email.split('@')[0],
        resetUrl,
        expiryMins: EXPIRY_MINUTES,
      }),
      emailType: 'password_reset',
    })

    return NextResponse.json({ ok: true })
  } catch (err: any) {
    if (err?.name === 'ZodError') {
      return NextResponse.json({ ok: false, error: 'Invalid email.' }, { status: 400 })
    }
    console.error('[POST /api/auth/forgot-password]', err)
    return NextResponse.json({ ok: false, error: 'Request failed.' }, { status: 500 })
  }
}
