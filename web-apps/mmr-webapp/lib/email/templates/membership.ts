/**
 * membership.ts — Membership lifecycle email templates
 *
 * Welcome / activation, renewal reminder, and expiration-repair notices.
 * See ../_layout.ts for the shared wrapper + brand constants.
 */

import { APP_URL, PORTAL, wrap } from '../_layout'
import { receiptBlock, testBanner } from './payments'
import { formatLongDate } from '../../date'
import { stageDef, stageFor, type RenewalStage } from '../../membership/renewal-stages'

// ── Welcome (membership activated) ───────────────────────────────────────────

export function welcomeEmailHtml(params: {
  firstName:  string
  memberId:   string
  expiresAt:  string
  planLabel:  string
  // Optional extras used by the Stripe fulfillment path: a receipt for the
  // payment that activated the membership, a first-time password link, and the
  // test-mode banner so pilot emails can never be mistaken for real ones.
  payment?: {
    amount:        number
    paymentMethod: string
    referenceId:   string
    paidOn:        string
  }
  setPasswordUrl?: string
  testMode?:       boolean
}): string {
  const { firstName, memberId, expiresAt, planLabel, payment, setPasswordUrl, testMode } = params
  const expiry = formatLongDate(expiresAt)
  return wrap(firstName, `
    ${testMode ? testBanner() : ''}
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

    ${payment ? receiptBlock({
      description:   `${planLabel} — payment received`,
      amount:        payment.amount,
      paymentMethod: payment.paymentMethod,
      paidOn:        payment.paidOn,
      referenceId:   payment.referenceId,
    }) : ''}

    ${setPasswordUrl ? `
    <div style="background:#f0f7ff;border:1px solid #cfe4ff;border-radius:12px;padding:20px;margin-bottom:24px;">
      <p style="color:#333;margin:0 0 12px;font-weight:600;">One more step: set your password</p>
      <p style="color:#555;margin:0 0 16px;font-size:14px;">
        Your account doesn't have a password yet. Set one to sign in and see your membership details,
        or sign in with the Google or Microsoft account that uses this email address.<br>
        您的账号还没有设置密码，请点击下方按钮设置密码后登录。
      </p>
      <a href="${setPasswordUrl}"
         style="display:inline-block;background:#0d6efd;color:#ffffff;padding:12px 28px;
                border-radius:99px;text-decoration:none;font-weight:600;font-size:15px;">
        Set My Password →
      </a>
    </div>
    ` : ''}

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

/**
 * One template, five stages (see lib/membership/renewal-stages.ts). The stage
 * drives the headline, the colour of the date card, and whether the copy talks
 * about time remaining or time already lapsed — the body is otherwise identical
 * so members recognise the mail across a cycle.
 *
 * `stage` is optional: callers that only know a day count (and the existing
 * tests) still work, and the stage is derived from `daysLeft`.
 */
export function renewalReminderEmailHtml(params: {
  firstName:   string
  memberId:    string
  expiresAt:   string
  daysLeft:    number
  stage?:      RenewalStage
  planLabel?:  string
  /** Names covered by a family membership, so the payer knows who lapses too. */
  familyMembers?: string[]
}): string {
  const { firstName, memberId, expiresAt, daysLeft, planLabel, familyMembers } = params
  const expiry = formatLongDate(expiresAt)
  const tone = (params.stage ? stageDef(params.stage) : stageFor(daysLeft))?.tone
    ?? (daysLeft < 0 ? 'lapsed' : 'heads-up')
  const lapsed = daysLeft < 0
  const lapsedDays = Math.abs(daysLeft)

  // Urgency prefixes are kept exactly as they were for the forward-looking
  // stages — members (and the template tests) already know this vocabulary.
  const prefix =
    tone === 'final'  ? 'Final notice: ' :
    tone === 'lapsed' ? '' :
    daysLeft <= 7     ? 'Urgent: ' :
    daysLeft <= 30    ? 'Action needed: ' : ''

  const headline = lapsed
    ? `${prefix}Your membership has expired`
    : tone === 'heads-up'
      ? 'Your membership renewal is now open'
      : `${prefix}Your membership expires soon`

  const timing = lapsed
    ? `expired on <strong>${expiry}</strong> — <strong>${lapsedDays} day${lapsedDays !== 1 ? 's' : ''}</strong> ago.`
    : daysLeft === 0
      ? `expires <strong>today</strong> (${expiry}).`
      : `expires on <strong>${expiry}</strong> — that's <strong>${daysLeft} day${daysLeft !== 1 ? 's' : ''}</strong> away.`

  // Amber for lapsed/final, brand purple while there is still time.
  const card = lapsed
    ? { bg: '#fff8e6', border: '#ffe2a8', label: '#b07d12', value: '#8a5d00', caption: 'Membership expired' }
    : { bg: '#f8f6ff', border: '#e9e3ff', label: '#9b8ec4', value: '#5c35a8', caption: 'Membership expires' }

  return wrap(firstName, `
    <h2 style="color:#5c35a8;margin:0 0 8px;">${headline}</h2>
    <p style="color:#555;margin:0 0 24px;">
      Hi ${firstName}, your Misty Mountain Runners membership
      (<span style="font-family:monospace;font-weight:600;color:#E86033;">${memberId}</span>)
      ${timing}
    </p>

    <div style="background:${card.bg};border:1px solid ${card.border};border-radius:12px;padding:20px;
                margin-bottom:24px;text-align:center;">
      <p style="margin:0;font-size:13px;color:${card.label};">${card.caption}</p>
      <p style="margin:6px 0 0;font-size:22px;font-weight:700;color:${card.value};">${expiry}</p>
      ${planLabel ? `
      <p style="margin:10px 0 0;font-size:13px;color:${card.label};">${planLabel}</p>
      ` : ''}
    </div>

    ${familyMembers && familyMembers.length > 1 ? `
    <div style="background:#f8f9fa;border:1px solid #e9ecef;border-radius:12px;padding:16px 20px;margin-bottom:24px;">
      <p style="margin:0 0 8px;font-size:13px;color:#888;">
        This family membership covers ${familyMembers.length} people:
      </p>
      <p style="margin:0;font-size:14px;color:#333;font-weight:600;">
        ${familyMembers.join(' · ')}
      </p>
      <p style="margin:8px 0 0;font-size:12px;color:#999;">
        One renewal covers everyone listed here. 一次续费即可覆盖以上全部家庭成员。
      </p>
    </div>
    ` : ''}

    <p style="color:#555;margin:0 0 16px;">
      ${lapsed
        ? 'Renew now to restore your access to club events, race results, team photos, and all member benefits.'
        : 'Renew now to keep your access to club events, race results, team photos, and all member benefits.'}
    </p>
    <a href="${APP_URL}/join"
       style="display:inline-block;background:#5c35a8;color:#ffffff;padding:12px 28px;
              border-radius:99px;text-decoration:none;font-weight:600;font-size:15px;">
      Renew My Membership →
    </a>
    ${tone === 'final' ? `
    <p style="color:#888;font-size:13px;margin:20px 0 0;">
      This is the last renewal reminder we'll send for this cycle. You're always welcome back —
      just renew any time. 这是本次续费周期的最后一封提醒邮件。
    </p>
    ` : ''}
    <p style="font-size:13px;color:#888;margin:24px 0 0;">
      ${lapsed
        ? `您的会员资格已于 ${expiry} 到期。请登录会员中心续费，以恢复岚山跑团的所有会员权益。`
        : `您的会员资格将于 ${expiry} 到期。请登录会员中心续费，以继续享受岚山跑团的所有会员权益。`}
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
  const expiry = formatLongDate(expiresAt)
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
