/**
 * auth.ts — Authentication email templates
 *
 * Password reset. See ../_layout.ts for the shared wrapper + brand constants.
 */

import { wrap } from '../_layout'

// ── Password reset ────────────────────────────────────────────────────────────

export function passwordResetEmailHtml(params: {
  firstName:   string
  resetUrl:    string
  expiryMins:  number
}): string {
  const { firstName, resetUrl, expiryMins } = params
  return wrap(firstName, `
    <h2 style="margin:0 0 8px;font-size:22px;font-weight:700;color:#5c35a8;">
      Reset your password
    </h2>
    <p style="font-size:13px;color:#888;margin:0 0 24px;">重置您的密码</p>

    <p style="color:#555;margin:0 0 20px;">
      Hi ${firstName}, we received a request to reset your MMR account password.
      Click the button below — this link expires in <strong>${expiryMins} minutes</strong>.
    </p>

    <a href="${resetUrl}"
       style="display:inline-block;background:#5c35a8;color:#ffffff;padding:14px 32px;
              border-radius:99px;text-decoration:none;font-weight:700;font-size:16px;
              letter-spacing:0.3px;">
      Reset Password →
    </a>

    <p style="font-size:13px;color:#888;margin:28px 0 0;">
      If you didn't request this, you can safely ignore this email —
      your password won't change.
    </p>
    <p style="font-size:12px;color:#bbb;margin:8px 0 0;">
      如果您没有请求重置密码，请忽略此邮件。您的密码不会发生任何变化。
    </p>

    <div style="margin-top:24px;padding:12px 16px;background:#f8f9fa;border-radius:8px;
                border-left:3px solid #5c35a8;">
      <p style="font-size:12px;color:#888;margin:0;">
        If the button above doesn't work, copy and paste this URL into your browser:
      </p>
      <p style="font-size:11px;color:#555;margin:6px 0 0;word-break:break-all;">
        ${resetUrl}
      </p>
    </div>
  `)
}
