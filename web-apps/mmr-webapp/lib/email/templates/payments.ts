/**
 * payments.ts — Payment & application email templates
 *
 * Application received, payment rejected/expired, and auto-match confirmation.
 * See ../_layout.ts for the shared wrapper + brand constants.
 */

import { FEEDBACK, PORTAL, wrap } from '../_layout'
import { formatLongDate } from '../../date'

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

// ── Payment confirmation / receipt ───────────────────────────────────────────
// Sent by the Stripe webhook once a payment is recorded. Doubles as the receipt
// for renewals and donations; brand-new members get welcomeEmailHtml instead
// (it carries the same receipt block plus the onboarding CTA).

export function paymentConfirmationEmailHtml(params: {
  firstName:     string
  amount:        number
  paymentMethod: string
  referenceId:   string
  description:   string   // e.g. 'Individual Membership' or 'Donation'
  paidOn:        string   // ISO date or human date
  expiresAt?:    string   // memberships only
  testMode?:     boolean
}): string {
  const { firstName, amount, paymentMethod, referenceId, description, paidOn, expiresAt, testMode } = params
  const isDonation = description.toLowerCase().includes('donation')

  return wrap(firstName, `
    ${testMode ? testBanner() : ''}
    <h2 style="color:#5c35a8;margin:0 0 8px;">
      ${isDonation ? `Thank you, ${firstName}!` : `Payment received, ${firstName}!`}
    </h2>
    <p style="color:#555;margin:0 0 24px;">
      ${isDonation
        ? 'Your donation to Misty Mountain Runners has been received. Thank you for supporting our running community.'
        : `We've received your payment and your <strong>${description}</strong> is up to date.`}
    </p>

    ${receiptBlock({ description, amount, paymentMethod, paidOn, referenceId, expiresAt })}

    <p style="font-size:13px;color:#888;margin:0;">
      ${isDonation
        ? '感谢您对岚山跑团的捐赠！这是您的收据，请妥善保存。'
        : '我们已收到您的付款，这是您的收据，请妥善保存。'}
      Reference #: <strong style="font-family:monospace;">${referenceId}</strong>
    </p>
  `)
}

// Shared receipt table — used by the confirmation email and the welcome email
export function receiptBlock(params: {
  description:   string
  amount:        number
  paymentMethod: string
  paidOn:        string
  referenceId:   string
  expiresAt?:    string
}): string {
  const { description, amount, paymentMethod, paidOn, referenceId, expiresAt } = params
  // formatLongDate keeps date-only values on their stored calendar day —
  // new Date('2027-03-31') is UTC midnight, which renders as March 30 anywhere
  // west of Greenwich.
  const fmt = (d: string) => formatLongDate(d) || d
  const row = (label: string, value: string, opts: { mono?: boolean; strong?: boolean } = {}) => `
    <tr>
      <td style="font-size:13px;color:#9b8ec4;padding:8px 0;">${label}</td>
      <td style="font-size:14px;color:#333;text-align:right;padding:8px 0;
                 ${opts.mono ? 'font-family:monospace;' : ''}
                 ${opts.strong ? 'font-weight:600;' : ''}">${value}</td>
    </tr>`

  return `
    <div style="background:#f8f6ff;border:1px solid #e9e3ff;border-radius:12px;padding:20px;margin-bottom:24px;">
      <table style="width:100%;border-collapse:collapse;font-family:sans-serif;">
        ${row('Paid for', description, { strong: true })}
        ${row('Amount', `$${amount.toFixed(2)}`, { strong: true })}
        ${row('Paid on', fmt(paidOn))}
        ${row('Method', paymentMethod)}
        ${expiresAt ? row('Membership valid until', fmt(expiresAt), { strong: true }) : ''}
        ${row('Reference #', referenceId, { mono: true, strong: true })}
      </table>
    </div>
  `
}

export function testBanner(): string {
  return `
    <div style="background:#fffbeb;border:1px solid #fde68a;border-radius:10px;padding:12px 16px;
                margin-bottom:20px;font-size:13px;color:#92400e;font-family:sans-serif;">
      ⚠️ <strong>Test payment</strong> — this was a simulated transaction. No money was charged and
      no real membership was granted.<br>
      测试付款 — 模拟交易，未产生真实扣款，也不构成真实会员资格。
    </div>
  `
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
  const expiry = formatLongDate(expiresAt)
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

// ── Auto-match confirmation ───────────────────────────────────────────────────

export function autoMatchConfirmationEmailHtml(params: {
  firstName:     string
  memberId:      string
  paymentIntent: string
  expiresAt:     string
  amount:        number
}): string {
  const { firstName, memberId, paymentIntent, expiresAt, amount } = params
  const expiry = formatLongDate(expiresAt)
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
