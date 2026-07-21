/**
 * membership.ts — Membership lifecycle email templates
 *
 * Welcome / activation, renewal reminder, and expiration-repair notices.
 * See ../_layout.ts for the shared wrapper + brand constants.
 */

import { APP_URL, PORTAL, wrap } from '../_layout'

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
