import { getDb } from '@/lib/db/connection'
import { sendEmail } from '@/lib/email/client'

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
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto;">
        <h2 style="color:#1F497D;">Misty Mountain Runners · 岚山跑团</h2>
        <p>Your one-time login code is:</p>
        <p style="font-size:36px;font-weight:bold;letter-spacing:8px;color:#E86033;">${code}</p>
        <p style="color:#888;font-size:12px;">Expires in ${OTP_EXPIRY_MINUTES} minutes. Do not share this code.</p>
        <hr/>
        <p style="color:#888;font-size:12px;">你的登录验证码：<strong style="color:#E86033;">${code}</strong>，${OTP_EXPIRY_MINUTES}分钟内有效。</p>
      </div>
    `,
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
