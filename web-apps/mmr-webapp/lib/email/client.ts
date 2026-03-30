import { EmailClient } from '@azure/communication-email'
import {
  welcomeEmailHtml,
  applicationReceivedEmailHtml,
  renewalReminderEmailHtml,
  paymentRejectedEmailHtml,
  paymentExpiredEmailHtml,
  expirationRepairedEmailHtml,
  autoMatchConfirmationEmailHtml,
} from './templates'
import pool from '@/lib/db/connection'

let client: EmailClient | undefined

function getEmailClient(): EmailClient {
  if (!client) {
    client = new EmailClient(process.env.AZURE_COMM_CONNECTION_STRING!)
  }
  return client
}

interface SendEmailParams {
  to: string
  subject: string
  html: string
  text?: string
  cc?: string | string[]
}

export async function sendEmail({ to, subject, html, text, cc }: SendEmailParams): Promise<void> {
  const emailClient = getEmailClient()

  // Normalize CC to array of objects
  let ccRecipients: Array<{ address: string }> = []
  if (cc) {
    const ccAddresses = Array.isArray(cc) ? cc : cc.split(',').map(e => e.trim())
    ccRecipients = ccAddresses.map(address => ({ address }))
  }

  const message = {
    senderAddress: process.env.EMAIL_SENDER_ADDRESS!,
    content: { subject, html, plainText: text ?? '' },
    recipients: {
      to: [{ address: to }],
      ...(ccRecipients.length > 0 && { cc: ccRecipients }),
    },
  }
  const poller = await emailClient.beginSend(message)
  await poller.pollUntilDone()
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
    to:      params.to,
    cc:      'admin@mmrunners.org',
    subject: `Welcome to Misty Mountain Runners! 🎉 Your Member ID: ${params.memberId}`,
    html:    welcomeEmailHtml({ ...params, planLabel }),
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
    to:      params.to,
    cc:      'admin@mmrunners.org',
    subject: `MMR Membership Application Received — Ref ${params.referenceId}`,
    html:    applicationReceivedEmailHtml(params),
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
        to:      member.email,
        cc:      'admin@mmrunners.org',
        subject: `Your MMR membership expires in ${member.days_left} day${member.days_left !== 1 ? 's' : ''}`,
        html:    renewalReminderEmailHtml({
          firstName,
          memberId:  member.member_id,
          expiresAt: String(member.expires_at),
          daysLeft:  Number(member.days_left),
        }),
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
    to:      params.to,
    cc:      'admin@mmrunners.org',
    subject: `MMR Payment Could Not Be Verified — Ref ${params.referenceId}`,
    html:    paymentRejectedEmailHtml(params),
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
    to:      params.to,
    cc:      'admin@mmrunners.org',
    subject: `⏰ Your MMR payment submission has expired — Ref ${params.referenceId}`,
    html:    paymentExpiredEmailHtml(params),
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
    to:      params.to,
    cc:      'admin@mmrunners.org',
    subject: `Your MMR membership record has been updated`,
    html:    expirationRepairedEmailHtml(params),
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
    to:      params.to,
    cc:      'admin@mmrunners.org',
    subject: `✅ Your MMR payment has been matched — Membership activated`,
    html:    autoMatchConfirmationEmailHtml(params),
  })
}
