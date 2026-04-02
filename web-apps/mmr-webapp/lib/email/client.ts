/**
 * Email client for MMR webapp — sends via GAS webhook
 * All emails route through Google Apps Script for unified sending.
 */

import {
  welcomeEmailHtml,
  applicationReceivedEmailHtml,
  renewalReminderEmailHtml,
  paymentRejectedEmailHtml,
  paymentExpiredEmailHtml,
  expirationRepairedEmailHtml,
  autoMatchConfirmationEmailHtml,
  passwordResetEmailHtml,
} from './templates'

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
    cc: cc ? (Array.isArray(cc) ? cc.join(',') : cc) : 'admin@mmrunners.org',
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
}): Promise<void> {
  const planLabel = params.planLabel ?? 'Individual Membership'
  await sendEmail({
    to:         params.to,
    cc:         'admin@mmrunners.org',
    subject:    `Welcome to Misty Mountain Runners! 🎉 Your Member ID: ${params.memberId}`,
    html:       welcomeEmailHtml({ ...params, planLabel }),
    emailType:  'welcome',
    memberId:   params.memberId,
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
    cc:        'admin@mmrunners.org',
    subject:   `MMR Membership Application Received — Ref ${params.referenceId}`,
    html:      applicationReceivedEmailHtml(params),
    emailType: 'application_received',
  })
}

// ── Renewal reminders ─────────────────────────────────────────────────────────
// Sends renewal reminders to members expiring within 60 days.
// Cap: max 3 reminders per member within any rolling 9-month window.
// Requires: renewal_reminders table (member_id, sent_at).

export async function sendRenewalReminders(): Promise<{ sent: number; skipped: number }> {
  const [members] = await pool.query<any[]>(
    `SELECT m.member_id, m.email, m.english_name, m.expires_at,
            DATEDIFF(m.expires_at, NOW()) AS days_left,
            COUNT(r.id) AS reminders_sent_9mo
     FROM members m
     LEFT JOIN renewal_reminders r
            ON r.member_id = m.member_id
           AND r.sent_at > DATE_SUB(NOW(), INTERVAL 9 MONTH)
     WHERE m.status = 'active'
       AND m.expires_at BETWEEN NOW() AND DATE_ADD(NOW(), INTERVAL 60 DAY)
     GROUP BY m.member_id, m.email, m.english_name, m.expires_at
     HAVING reminders_sent_9mo < 3
     ORDER BY m.expires_at ASC`
  )

  let sent = 0, skipped = 0

  for (const member of members) {
    const firstName = (member.english_name ?? member.email).split(' ')[0]
    try {
      await sendEmail({
        to:        member.email,
        cc:        'admin@mmrunners.org',
        subject:   `Your MMR membership expires in ${member.days_left} day${member.days_left !== 1 ? 's' : ''}`,
        html:      renewalReminderEmailHtml({
          firstName,
          memberId:  member.member_id,
          expiresAt: String(member.expires_at),
          daysLeft:  Number(member.days_left),
        }),
        emailType: 'renewal_reminder',
        memberId:  member.member_id,
      })

      await pool.query(
        `INSERT INTO renewal_reminders (member_id, sent_at) VALUES (?, NOW())`,
        [member.member_id]
      )
      sent++
    } catch (err) {
      console.error(`[renewal-reminder] Failed for ${member.member_id}:`, err)
      skipped++
    }
  }

  return { sent, skipped }
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
    cc:        'admin@mmrunners.org',
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
    cc:        'admin@mmrunners.org',
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
    cc:        'admin@mmrunners.org',
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
    cc:        'admin@mmrunners.org',
    subject:   `✅ Your MMR payment has been matched — Membership activated`,
    html:      autoMatchConfirmationEmailHtml(params),
    emailType: 'auto_match_confirmation',
    memberId:  params.memberId,
  })
}
