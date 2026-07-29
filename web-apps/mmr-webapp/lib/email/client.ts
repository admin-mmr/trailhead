/**
 * Email client for MMR webapp — sends via GAS webhook
 * All emails route through Google Apps Script for unified sending.
 */

import {
  welcomeEmailHtml,
  applicationReceivedEmailHtml,
  paymentConfirmationEmailHtml,
  renewalReminderEmailHtml,
  paymentRejectedEmailHtml,
  paymentExpiredEmailHtml,
  expirationRepairedEmailHtml,
  autoMatchConfirmationEmailHtml,
  passwordResetEmailHtml,
} from './templates'

/**
 * The address that gets a copy of member-facing membership and payment mail, so
 * the club has a record of what was sent. Opt-in per call — see sendEmail.
 */
export const ADMIN_CC = 'admin@mmrunners.org'

interface SendEmailParams {
  to: string
  subject: string
  html: string
  text?: string
  cc?: string | string[]
  emailType?: string
  memberId?: string
}

async function getGasWebhookUrl(): Promise<string> {
  const url = process.env.GAS_WEBHOOK_URL
  if (!url) {
    throw new Error('GAS_WEBHOOK_URL not set in environment')
  }
  return url
}

export async function sendEmail({
  to,
  subject,
  html,
  text,
  cc,
  emailType,
  memberId,
}: SendEmailParams): Promise<void> {
  const webhookUrl = await getGasWebhookUrl()

  const payload = {
    action: 'email_send',
    to,
    subject,
    html_content: html,
    text_content: text || undefined,
    // CC is opt-in. It used to fall back to ADMIN_CC for every email, which put
    // password-reset mail — a live, unexpired token link — in the admin inbox,
    // and sent the admin a duplicate of every admin-list notification. Callers
    // that want the club copy pass it explicitly; the helpers below all do.
    cc: cc ? (Array.isArray(cc) ? cc.join(',') : cc) : undefined,
    email_type: emailType,
    member_id: memberId,
  }

  const response = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(30000),
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(
      `GAS webhook failed: ${response.status} ${response.statusText} - ${errorText}`
    )
  }
}

// ── Welcome / membership activated ────────────────────────────────────────────

export async function sendMemberWelcomeEmail(params: {
  to:         string
  firstName:  string
  memberId:   string
  expiresAt:  string
  planLabel?: string
  // Stripe fulfillment extras — see welcomeEmailHtml
  payment?: {
    amount:        number
    paymentMethod: string
    referenceId:   string
    paidOn:        string
  }
  setPasswordUrl?: string
  testMode?:       boolean
}): Promise<void> {
  const planLabel = params.planLabel ?? 'Individual Membership'
  await sendEmail({
    to:         params.to,
    cc:         ADMIN_CC,
    subject:    `${params.testMode ? '[TEST] ' : ''}Welcome to Misty Mountain Runners! 🎉 Your Member ID: ${params.memberId}`,
    html:       welcomeEmailHtml({ ...params, planLabel }),
    emailType:  'welcome',
    memberId:   params.memberId,
  })
}

// ── Payment confirmation / receipt ───────────────────────────────────────────

export async function sendPaymentConfirmationEmail(params: {
  to:            string
  firstName:     string
  amount:        number
  paymentMethod: string
  referenceId:   string
  description:   string
  paidOn:        string
  expiresAt?:    string
  memberId?:     string
  testMode?:     boolean
}): Promise<void> {
  const isDonation = params.description.toLowerCase().includes('donation')
  await sendEmail({
    to:        params.to,
    cc:        ADMIN_CC,
    subject:   `${params.testMode ? '[TEST] ' : ''}${isDonation
      ? 'Thank you for your donation to Misty Mountain Runners'
      : `MMR payment received — $${params.amount.toFixed(2)}`}`,
    html:      paymentConfirmationEmailHtml(params),
    emailType: isDonation ? 'donation_receipt' : 'payment_confirmation',
    memberId:  params.memberId,
  })
}

// ── Payment application received ─────────────────────────────────────────────

export async function sendApplicationReceivedEmail(params: {
  to:            string
  firstName:     string
  planLabel:     string
  amount:        number
  paymentMethod: string
  referenceId:   string
}): Promise<void> {
  await sendEmail({
    to:        params.to,
    cc:        ADMIN_CC,
    subject:   `MMR Membership Application Received — Ref ${params.referenceId}`,
    html:      applicationReceivedEmailHtml(params),
    emailType: 'application_received',
  })
}

// ── Payment rejected ──────────────────────────────────────────────────────────

export async function sendPaymentRejectedEmail(params: {
  to:            string
  firstName:     string
  planLabel:     string
  amount:        number
  referenceId:   string
  reason?:       string
}): Promise<void> {
  await sendEmail({
    to:        params.to,
    cc:        ADMIN_CC,
    subject:   `MMR Payment Could Not Be Verified — Ref ${params.referenceId}`,
    html:      paymentRejectedEmailHtml(params),
    emailType: 'payment_rejected',
  })
}

// ── Payment expired ───────────────────────────────────────────────────────────

export async function sendPaymentExpiredEmail(params: {
  to:          string
  firstName:   string
  referenceId: string
  expiresAt:   string
}): Promise<void> {
  await sendEmail({
    to:        params.to,
    cc:        ADMIN_CC,
    subject:   `⏰ Your MMR payment submission has expired — Ref ${params.referenceId}`,
    html:      paymentExpiredEmailHtml(params),
    emailType: 'payment_expired',
  })
}

// ── Expiration repaired ───────────────────────────────────────────────────────

export async function sendExpirationRepairedEmail(params: {
  to:        string
  firstName: string
  memberId:  string
  expiresAt: string
  planLabel: string
}): Promise<void> {
  await sendEmail({
    to:        params.to,
    cc:        ADMIN_CC,
    subject:   `Your MMR membership record has been updated`,
    html:      expirationRepairedEmailHtml(params),
    emailType: 'expiration_repaired',
    memberId:  params.memberId,
  })
}

// ── Auto-match confirmation ───────────────────────────────────────────────────

export async function sendAutoMatchConfirmationEmail(params: {
  to:            string
  firstName:     string
  memberId:      string
  paymentIntent: string
  expiresAt:     string
  amount:        number
}): Promise<void> {
  await sendEmail({
    to:        params.to,
    cc:        ADMIN_CC,
    subject:   `✅ Your MMR payment has been matched — Membership activated`,
    html:      autoMatchConfirmationEmailHtml(params),
    emailType: 'auto_match_confirmation',
    memberId:  params.memberId,
  })
}
