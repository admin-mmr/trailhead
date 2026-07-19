/**
 * templates.ts — Shared HTML email templates for MMR
 *
 * All templates:
 *  - Use first name only in the greeting
 *  - Include a portal CTA footer
 *  - Welcome feedback with a reply-to prompt
 *  - Bilingual (English + Chinese) — members read both
 *  - Brand-consistent colours (#5c35a8 purple, #E86033 orange)
 */

const APP_URL  = process.env.NEXT_PUBLIC_APP_URL ?? 'https://mmrunners.org'
const PORTAL   = `${APP_URL}/portal`
const FEEDBACK = 'admin@mmrunners.org'

// ── Shared layout wrappers ────────────────────────────────────────────────────

function header(): string {
  return `
    <div style="background:#5c35a8;padding:28px 32px;text-align:center;">
      <h1 style="color:#ffffff;margin:0;font-size:22px;font-family:sans-serif;letter-spacing:1px;">
        Misty Mountain Runners
      </h1>
      <p style="color:rgba(255,255,255,0.7);margin:6px 0 0;font-size:13px;font-family:sans-serif;">
        岚山跑团 · New York Running Community
      </p>
    </div>
  `
}

function portalFooter(firstName: string): string {
  return `
    <div style="margin-top:32px;padding:20px 32px;background:#f8f9fa;border-top:1px solid #e9ecef;">
      <p style="font-family:sans-serif;font-size:13px;color:#666;margin:0 0 12px;">
        Your member portal is always available at:
      </p>
      <a href="${PORTAL}"
         style="display:inline-block;background:#5c35a8;color:#ffffff;padding:10px 24px;
                border-radius:99px;text-decoration:none;font-weight:600;font-size:14px;
                font-family:sans-serif;">
        Open Member Portal →
      </a>
      <p style="font-family:sans-serif;font-size:12px;color:#999;margin:16px 0 0;">
        Have feedback or questions? We'd love to hear from you — just reply to this email or write to
        <a href="mailto:${FEEDBACK}" style="color:#5c35a8;">${FEEDBACK}</a>.
      </p>
    </div>
  `
}

function wrap(firstName: string, body: string): string {
  return `
    <!DOCTYPE html>
    <html lang="en">
    <head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
    <body style="margin:0;padding:0;background:#f0f2f5;">
      <div style="max-width:600px;margin:32px auto;background:#ffffff;
                  border-radius:16px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.06);">
        ${header()}
        <div style="padding:32px;font-family:sans-serif;color:#333;">
          ${body}
        </div>
        ${portalFooter(firstName)}
      </div>
    </body>
    </html>
  `
}

// ── Welcome (membership activated) ───────────────────────────────────────────

export function welcomeEmailHtml(params: {
  firstName:  string
  memberId:   string
  expiresAt:  string
  planLabel:  string
}): string {
  const { firstName, memberId, expiresAt, planLabel } = params
  const expiry = new Date(expiresAt).toLocaleDateString('en-US', {
    year: 'numeric', month: 'long', day: 'numeric',
  })
  return wrap(firstName, `
    <h2 style="color:#5c35a8;margin:0 0 8px;">Welcome, ${firstName}! 🎉</h2>
    <p style="color:#555;margin:0 0 24px;">
      Your <strong>${planLabel}</strong> membership is now active. We're so glad you're part of
      Misty Mountain Runners!
    </p>

    <div style="background:#f8f6ff;border:1px solid #e9e3ff;border-radius:12px;padding:20px;margin-bottom:24px;">
      <table style="width:100%;border-collapse:collapse;">
        <tr>
          <td style="font-size:13px;color:#9b8ec4;padding-bottom:8px;">Member ID</td>
          <td style="font-size:24px;font-weight:700;color:#5c35a8;font-family:monospace;
                     letter-spacing:2px;text-align:right;">${memberId}</td>
        </tr>
        <tr>
          <td style="font-size:13px;color:#888;padding-top:8px;">Membership plan</td>
          <td style="font-size:14px;font-weight:600;color:#333;text-align:right;padding-top:8px;">
            ${planLabel}
          </td>
        </tr>
        <tr>
          <td style="font-size:13px;color:#888;padding-top:8px;">Valid until</td>
          <td style="font-size:14px;color:#333;text-align:right;padding-top:8px;">${expiry}</td>
        </tr>
      </table>
    </div>

    <p style="color:#555;margin:0 0 16px;">
      Visit your member portal to explore race results, upcoming events, club photos, and more.
    </p>
    <a href="${PORTAL}"
       style="display:inline-block;background:#5c35a8;color:#ffffff;padding:12px 28px;
              border-radius:99px;text-decoration:none;font-weight:600;font-size:15px;">
      Go to My Portal →
    </a>
    <p style="font-size:13px;color:#888;margin:24px 0 0;">
      欢迎加入岚山跑团！您的会员编号为 <strong style="color:#E86033;">${memberId}</strong>，
      会员有效期至 ${expiry}。
    </p>
  `)
}

// ── Payment application received ─────────────────────────────────────────────

export function applicationReceivedEmailHtml(params: {
  firstName:     string
  planLabel:     string
  amount:        number
  paymentMethod: string
  referenceId:   string
}): string {
  const { firstName, planLabel, amount, paymentMethod, referenceId } = params
  return wrap(firstName, `
    <h2 style="color:#5c35a8;margin:0 0 8px;">Application received, ${firstName}!</h2>
    <p style="color:#555;margin:0 0 24px;">
      Thanks for applying to join Misty Mountain Runners. Here's a summary of your submission:
    </p>

    <div style="background:#f8f6ff;border:1px solid #e9e3ff;border-radius:12px;padding:20px;margin-bottom:24px;">
      <table style="width:100%;border-collapse:collapse;font-family:sans-serif;">
        <tr>
          <td style="font-size:13px;color:#9b8ec4;padding-bottom:8px;">Plan</td>
          <td style="font-size:14px;font-weight:600;color:#333;text-align:right;padding-bottom:8px;">
            ${planLabel}
          </td>
        </tr>
        <tr>
          <td style="font-size:13px;color:#9b8ec4;padding:8px 0;">Amount</td>
          <td style="font-size:14px;font-weight:600;color:#333;text-align:right;padding:8px 0;">
            $${amount}
          </td>
        </tr>
        <tr>
          <td style="font-size:13px;color:#9b8ec4;padding:8px 0;">Payment via</td>
          <td style="font-size:14px;color:#333;text-align:right;padding:8px 0;text-transform:capitalize;">
            ${paymentMethod}
          </td>
        </tr>
        <tr>
          <td style="font-size:13px;color:#9b8ec4;padding-top:8px;">Reference #</td>
          <td style="font-size:14px;font-family:monospace;font-weight:600;color:#5c35a8;
                     text-align:right;padding-top:8px;">${referenceId}</td>
        </tr>
      </table>
    </div>

    <p style="color:#555;margin:0 0 12px;">
      Our team will verify your ${paymentMethod} payment and activate your membership within
      <strong>1–2 business days</strong>. You'll receive another email once you're all set.
    </p>
    <p style="color:#555;margin:0 0 24px;">
      To speed things up, you can upload a screenshot of your payment through the member portal:
    </p>
    <a href="${PORTAL}/payment-proof"
       style="display:inline-block;background:#5c35a8;color:#ffffff;padding:12px 28px;
              border-radius:99px;text-decoration:none;font-weight:600;font-size:15px;">
      Upload Payment Screenshot →
    </a>
  `)
}

// ── Renewal reminder ──────────────────────────────────────────────────────────

export function renewalReminderEmailHtml(params: {
  firstName:   string
  memberId:    string
  expiresAt:   string
  daysLeft:    number
}): string {
  const { firstName, memberId, expiresAt, daysLeft } = params
  const expiry = new Date(expiresAt).toLocaleDateString('en-US', {
    year: 'numeric', month: 'long', day: 'numeric',
  })
  const urgency = daysLeft <= 7 ? 'Urgent: ' : daysLeft <= 30 ? 'Action needed: ' : ''
  return wrap(firstName, `
    <h2 style="color:#5c35a8;margin:0 0 8px;">${urgency}Your membership expires soon</h2>
    <p style="color:#555;margin:0 0 24px;">
      Hi ${firstName}, your Misty Mountain Runners membership
      (<span style="font-family:monospace;font-weight:600;color:#E86033;">${memberId}</span>)
      expires on <strong>${expiry}</strong> — that's <strong>${daysLeft} day${daysLeft !== 1 ? 's' : ''}</strong> away.
    </p>

    <div style="background:#f8f6ff;border:1px solid #e9e3ff;border-radius:12px;padding:20px;
                margin-bottom:24px;text-align:center;">
      <p style="margin:0;font-size:13px;color:#9b8ec4;">Membership expires</p>
      <p style="margin:6px 0 0;font-size:22px;font-weight:700;color:#5c35a8;">${expiry}</p>
    </div>

    <p style="color:#555;margin:0 0 16px;">
      Renew now to keep your access to club events, race results, team photos, and all member benefits.
    </p>
    <a href="${APP_URL}/join"
       style="display:inline-block;background:#5c35a8;color:#ffffff;padding:12px 28px;
              border-radius:99px;text-decoration:none;font-weight:600;font-size:15px;">
      Renew My Membership →
    </a>
    <p style="font-size:13px;color:#888;margin:24px 0 0;">
      您的会员资格将于 ${expiry} 到期。请登录会员中心续费，以继续享受岚山跑团的所有会员权益。
    </p>
  `)
}

// ── Payment approved / membership activated (admin action) ───────────────────

export function membershipActivatedEmailHtml(params: {
  firstName:  string
  memberId:   string
  expiresAt:  string
  planLabel:  string
}): string {
  // Re-use welcome template — same content, same joy
  return welcomeEmailHtml(params)
}

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

// ── Payment rejected ──────────────────────────────────────────────────────────

export function paymentRejectedEmailHtml(params: {
  firstName:   string
  planLabel:   string
  amount:      number
  referenceId: string
  reason?:     string
}): string {
  const { firstName, planLabel, amount, referenceId, reason } = params
  return wrap(firstName, `
    <h2 style="color:#c62828;margin:0 0 8px;">Payment couldn't be verified</h2>
    <p style="color:#555;margin:0 0 24px;">
      Hi ${firstName}, unfortunately we were unable to verify your payment for your
      <strong>${planLabel}</strong> membership.
    </p>

    <div style="background:#fff5f5;border:1px solid #fecaca;border-radius:12px;padding:20px;
                margin-bottom:24px;">
      <table style="width:100%;border-collapse:collapse;font-family:sans-serif;">
        <tr>
          <td style="font-size:13px;color:#e57373;padding-bottom:8px;">Plan</td>
          <td style="font-size:14px;font-weight:600;color:#333;text-align:right;padding-bottom:8px;">
            ${planLabel}
          </td>
        </tr>
        <tr>
          <td style="font-size:13px;color:#e57373;padding:8px 0;">Amount</td>
          <td style="font-size:14px;font-weight:600;color:#333;text-align:right;padding:8px 0;">
            $${amount}
          </td>
        </tr>
        <tr>
          <td style="font-size:13px;color:#e57373;padding-top:8px;">Reference</td>
          <td style="font-size:14px;font-family:monospace;color:#c62828;text-align:right;padding-top:8px;">
            ${referenceId}
          </td>
        </tr>
      </table>
    </div>

    ${reason ? `
    <div style="background:#fff5f5;border-left:3px solid #c62828;padding:16px;margin-bottom:24px;">
      <p style="font-size:13px;color:#666;margin:0;"><strong>Reason:</strong> ${reason}</p>
    </div>
    ` : ''}

    <p style="color:#555;margin:0 0 16px;">
      Please check that your payment was sent correctly, then resubmit your payment information:
    </p>
    <a href="${PORTAL}/payment"
       style="display:inline-block;background:#5c35a8;color:#ffffff;padding:12px 28px;
              border-radius:99px;text-decoration:none;font-weight:600;font-size:15px;">
      Resubmit Payment →
    </a>

    <p style="color:#555;margin:24px 0 0;">
      If you need help or have questions about your payment, please reply to this email or contact us at
      <a href="mailto:${FEEDBACK}" style="color:#5c35a8;">${FEEDBACK}</a>.
    </p>
  `)
}

// ── Payment expired ───────────────────────────────────────────────────────────

export function paymentExpiredEmailHtml(params: {
  firstName:   string
  referenceId: string
  expiresAt:   string
}): string {
  const { firstName, referenceId, expiresAt } = params
  const expiry = new Date(expiresAt).toLocaleDateString('en-US', {
    year: 'numeric', month: 'long', day: 'numeric',
  })
  return wrap(firstName, `
    <h2 style="color:#c62828;margin:0 0 8px;">⏰ Payment submission expired</h2>
    <p style="color:#555;margin:0 0 24px;">
      Hi ${firstName}, your payment submission (Ref <code style="background:#f5f5f5;padding:2px 6px;
      border-radius:4px;font-family:monospace;">${referenceId}</code>) expired on <strong>${expiry}</strong>
      before we could verify it.
    </p>

    <div style="background:#fff5f5;border:1px solid #fecaca;border-radius:12px;padding:20px;
                margin-bottom:24px;text-align:center;">
      <p style="margin:0;font-size:13px;color:#c62828;">Expired on</p>
      <p style="margin:6px 0 0;font-size:18px;font-weight:700;color:#c62828;">${expiry}</p>
    </div>

    <p style="color:#555;margin:0 0 16px;">
      If you've already paid, please resubmit your payment proof so we can activate your membership.
      If you haven't paid yet, you can submit your payment now:
    </p>
    <a href="${PORTAL}/payment"
       style="display:inline-block;background:#5c35a8;color:#ffffff;padding:12px 28px;
              border-radius:99px;text-decoration:none;font-weight:600;font-size:15px;">
      Submit or Resubmit Payment →
    </a>

    <p style="color:#555;margin:24px 0 0;">
      If you have any questions, just reply to this email or reach out to
      <a href="mailto:${FEEDBACK}" style="color:#5c35a8;">${FEEDBACK}</a>.
    </p>
  `)
}

// ── Expiration repaired ───────────────────────────────────────────────────────

export function expirationRepairedEmailHtml(params: {
  firstName:   string
  memberId:    string
  expiresAt:   string
  planLabel:   string
}): string {
  const { firstName, memberId, expiresAt, planLabel } = params
  const expiry = new Date(expiresAt).toLocaleDateString('en-US', {
    year: 'numeric', month: 'long', day: 'numeric',
  })
  return wrap(firstName, `
    <h2 style="color:#5c35a8;margin:0 0 8px;">✓ Membership record updated</h2>
    <p style="color:#555;margin:0 0 24px;">
      Hi ${firstName}, we performed a routine verification of your membership record and made a small update.
      No action is needed from you.
    </p>

    <div style="background:#f8f6ff;border:1px solid #e9e3ff;border-radius:12px;padding:20px;
                margin-bottom:24px;">
      <table style="width:100%;border-collapse:collapse;font-family:sans-serif;">
        <tr>
          <td style="font-size:13px;color:#9b8ec4;padding-bottom:8px;">Member ID</td>
          <td style="font-size:14px;font-weight:600;color:#5c35a8;text-align:right;padding-bottom:8px;">
            ${memberId}
          </td>
        </tr>
        <tr>
          <td style="font-size:13px;color:#9b8ec4;padding:8px 0;">Plan</td>
          <td style="font-size:14px;font-weight:600;color:#333;text-align:right;padding:8px 0;">
            ${planLabel}
          </td>
        </tr>
        <tr>
          <td style="font-size:13px;color:#9b8ec4;padding-top:8px;">Valid until</td>
          <td style="font-size:14px;font-weight:700;color:#5c35a8;text-align:right;padding-top:8px;">
            ${expiry}
          </td>
        </tr>
      </table>
    </div>

    <p style="color:#555;margin:0 0 16px;">
      We've corrected your membership expiration date to ensure it reflects your actual payment record.
      Your membership is valid and you have full access to all member benefits.
    </p>
    <a href="${PORTAL}"
       style="display:inline-block;background:#5c35a8;color:#ffffff;padding:12px 28px;
              border-radius:99px;text-decoration:none;font-weight:600;font-size:15px;">
      View My Portal →
    </a>

    <p style="color:#555;margin:24px 0 0;">
      If you think this is incorrect or have any questions, just reply to this email.
    </p>
  `)
}

// ── Auto-match confirmation ───────────────────────────────────────────────────

export function autoMatchConfirmationEmailHtml(params: {
  firstName:     string
  memberId:      string
  paymentIntent: string
  expiresAt:     string
  amount:        number
}): string {
  const { firstName, memberId, paymentIntent, expiresAt, amount } = params
  const expiry = new Date(expiresAt).toLocaleDateString('en-US', {
    year: 'numeric', month: 'long', day: 'numeric',
  })
  return wrap(firstName, `
    <h2 style="color:#5c35a8;margin:0 0 8px;">✅ Payment matched & membership updated</h2>
    <p style="color:#555;margin:0 0 24px;">
      Hi ${firstName}, we found your <strong>${paymentIntent}</strong> payment ($${amount}) and have automatically
      updated your membership. You're all set!
    </p>

    <div style="background:#f8f6ff;border:1px solid #e9e3ff;border-radius:12px;padding:20px;
                margin-bottom:24px;">
      <table style="width:100%;border-collapse:collapse;font-family:sans-serif;">
        <tr>
          <td style="font-size:13px;color:#9b8ec4;padding-bottom:8px;">Member ID</td>
          <td style="font-size:18px;font-weight:800;color:#5c35a8;text-align:right;padding-bottom:8px;">
            ${memberId}
          </td>
        </tr>
        <tr>
          <td style="font-size:13px;color:#9b8ec4;padding:8px 0;">Plan</td>
          <td style="font-size:14px;font-weight:600;color:#333;text-align:right;padding:8px 0;">
            ${paymentIntent}
          </td>
        </tr>
        <tr>
          <td style="font-size:13px;color:#9b8ec4;padding-top:8px;">Valid until</td>
          <td style="font-size:14px;font-weight:700;color:#5c35a8;text-align:right;padding-top:8px;">
            ${expiry}
          </td>
        </tr>
      </table>
    </div>

    <p style="color:#555;margin:0 0 16px;">
      Your membership is now active and you have access to all member benefits including club events,
      race results, and team photos.
    </p>
    <a href="${PORTAL}"
       style="display:inline-block;background:#5c35a8;color:#ffffff;padding:12px 28px;
              border-radius:99px;text-decoration:none;font-weight:600;font-size:15px;">
      Go to My Portal →
    </a>

    <p style="font-size:13px;color:#888;margin:24px 0 0;">
      We matched your payment automatically using your Member ID. If you think this is incorrect,
      please reply to this email and we'll sort it out right away.
    </p>
  `)
}
