import { getDb } from '@/lib/db/connection'
import { sendEmail } from '@/lib/email/client'
import { otpEmailHtml } from '@/lib/email/templates'

const OTP_EXPIRY_MINUTES = Number(process.env.OTP_EXPIRY_MINUTES ?? 10)

function generateCode(): string {
  return Math.floor(100000 + Math.random() * 900000).toString()
}

export async function requestEmailOtp(email: string): Promise<void> {
  const db   = await getDb()
  const code = generateCode()
  const expiresAt = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000)

  // Upsert — invalidate any prior code for this email
  await db.execute(
    `INSERT INTO otp_codes (email, code, expires_at, used)
     VALUES (?, ?, ?, 0)
     ON DUPLICATE KEY UPDATE code = VALUES(code), expires_at = VALUES(expires_at), used = 0`,
    [email, code, expiresAt]
  )

  await sendEmail({
    to: email,
    subject: 'Your MMR login code · 岚山跑团验证码',
    html: otpEmailHtml({ code, expiryMinutes: OTP_EXPIRY_MINUTES }),
  })
}

export async function verifyEmailOtp(email: string, code: string): Promise<boolean> {
  const db = await getDb()
  const [rows] = await db.execute<any[]>(
    `SELECT id FROM otp_codes
     WHERE email = ? AND code = ? AND used = 0 AND expires_at > NOW()
     LIMIT 1`,
    [email, code]
  )
  if (!rows.length) return false

  // Mark as used
  await db.execute(
    `UPDATE otp_codes SET used = 1 WHERE email = ?`,
    [email]
  )
  return true
}
