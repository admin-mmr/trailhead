/**
 * templates.ts — Shared HTML email templates for MMR
 *
 * All templates:
 *  - Use first name only in the greeting
 *  - Include a portal CTA footer
 *  - Welcome feedback with a reply-to prompt
 *  - Brand-consistent colours (#1F497D navy, #E86033 orange)
 */

const APP_URL  = process.env.NEXT_PUBLIC_APP_URL ?? 'https://mistymountainrunners.org'
const PORTAL   = `${APP_URL}/portal`
const FEEDBACK = 'info@mistymountainrunners.org'

// ── Shared layout wrappers ────────────────────────────────────────────────────

function header(): string {
  return `
    <div style="background:#1F497D;padding:28px 32px;text-align:center;">
      <h1 style="color:#ffffff;margin:0;font-size:22px;font-family:sans-serif;letter-spacing:1px;">
        Misty Mountain Runners
      </h1>
      <p style="color:rgba(255,255,255,0.65);margin:6px 0 0;font-size:13px;font-family:sans-serif;">
        岚山跑团
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
         style="display:inline-block;background:#E86033;color:#ffffff;padding:10px 24px;
                border-radius:99px;text-decoration:none;font-weight:600;font-size:14px;
                font-family:sans-serif;">
        Open Member Portal →
      </a>
      <p style="font-family:sans-serif;font-size:12px;color:#999;margin:16px 0 0;">
        Have feedback or questions? We'd love to hear from you — just reply to this email or write to
        <a href="mailto:${FEEDBACK}" style="color:#1F497D;">${FEEDBACK}</a>.
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

// ── OTP / Login code ──────────────────────────────────────────────────────────

export function otpEmailHtml(params: {
  code:             string
  expiryMinutes:    number
}): string {
  const { code, expiryMinutes } = params
  return wrap('there', `
    <h2 style="color:#1F497D;margin:0 0 8px;">Your login code</h2>
    <p style="color:#555;margin:0 0 24px;">
      Use the code below to sign in to your MMR member portal.
    </p>
    <div style="background:#f5f7fa;border-radius:12px;padding:24px;text-align:center;margin-bottom:24px;">
      <p style="margin:0;font-size:12px;color:#999;letter-spacing:1px;text-transform:uppercase;">
        One-time code
      </p>
      <p style="margin:8px 0 0;font-size:42px;font-weight:700;letter-spacing:10px;color:#E86033;
                font-family:monospace;">
        ${code}
      </p>
      <p style="margin:8px 0 0;font-size:12px;color:#aaa;">
        Expires in ${expiryMinutes} minutes · Do not share this code
      </p>
    </div>
    <p style="font-size:13px;color:#888;margin:0;">
      你的登录验证码：<strong style="color:#E86033;">${code}</strong>，${expiryMinutes} 分钟内有效。
    </p>
  `)
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
    <h2 style="color:#1F497D;margin:0 0 8px;">Welcome, ${firstName}! 🎉</h2>
    <p style="color:#555;margin:0 0 24px;">
      Your <strong>${planLabel}</strong> membership is now active. We're so glad you're part of
      Misty Mountain Runners!
    </p>

    <div style="background:#f5f7fa;border-radius:12px;padding:20px;margin-bottom:24px;">
      <table style="width:100%;border-collapse:collapse;">
        <tr>
          <td style="font-size:13px;color:#888;padding-bottom:8px;">Member ID</td>
          <td style="font-size:24px;font-weight:700;color:#E86033;font-family:monospace;
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
       style="display:inline-block;background:#1F497D;color:#ffffff;padding:12px 28px;
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
    <h2 style="color:#1F497D;margin:0 0 8px;">Application received, ${firstName}!</h2>
    <p style="color:#555;margin:0 0 24px;">
      Thanks for applying to join Misty Mountain Runners. Here's a summary of your submission:
    </p>

    <div style="background:#f5f7fa;border-radius:12px;padding:20px;margin-bottom:24px;">
      <table style="width:100%;border-collapse:collapse;font-family:sans-serif;">
        <tr>
          <td style="font-size:13px;color:#888;padding-bottom:8px;">Plan</td>
          <td style="font-size:14px;font-weight:600;color:#333;text-align:right;padding-bottom:8px;">
            ${planLabel}
          </td>
        </tr>
        <tr>
          <td style="font-size:13px;color:#888;padding:8px 0;">Amount</td>
          <td style="font-size:14px;font-weight:600;color:#333;text-align:right;padding:8px 0;">
            $${amount}
          </td>
        </tr>
        <tr>
          <td style="font-size:13px;color:#888;padding:8px 0;">Payment via</td>
          <td style="font-size:14px;color:#333;text-align:right;padding:8px 0;text-transform:capitalize;">
            ${paymentMethod}
          </td>
        </tr>
        <tr>
          <td style="font-size:13px;color:#888;padding-top:8px;">Reference #</td>
          <td style="font-size:14px;font-family:monospace;font-weight:600;color:#E86033;
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
       style="display:inline-block;background:#E86033;color:#ffffff;padding:12px 28px;
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
    <h2 style="color:#1F497D;margin:0 0 8px;">${urgency}Your membership expires soon</h2>
    <p style="color:#555;margin:0 0 24px;">
      Hi ${firstName}, your Misty Mountain Runners membership
      (<span style="font-family:monospace;font-weight:600;color:#E86033;">${memberId}</span>)
      expires on <strong>${expiry}</strong> — that's <strong>${daysLeft} day${daysLeft !== 1 ? 's' : ''}</strong> away.
    </p>

    <div style="background:#fff8f5;border:1px solid #fdddd3;border-radius:12px;padding:20px;
                margin-bottom:24px;text-align:center;">
      <p style="margin:0;font-size:13px;color:#c0502a;">Membership expires</p>
      <p style="margin:6px 0 0;font-size:22px;font-weight:700;color:#E86033;">${expiry}</p>
    </div>

    <p style="color:#555;margin:0 0 16px;">
      Renew now to keep your access to club events, race results, team photos, and all member benefits.
    </p>
    <a href="${APP_URL}/join"
       style="display:inline-block;background:#E86033;color:#ffffff;padding:12px 28px;
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
