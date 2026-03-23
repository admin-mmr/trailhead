import { EmailClient } from '@azure/communication-email'
import {
  welcomeEmailHtml,
  applicationReceivedEmailHtml,
  renewalReminderEmailHtml,
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
}

export async function sendEmail({ to, subject, html, text }: SendEmailParams): Promise<void> {
  const emailClient = getEmailClient()
  const message = {
    senderAddress: process.env.EMAIL_SENDER_ADDRESS!,
    content: { subject, html, plainText: text ?? '' },
    recipients: { to: [{ address: to }] },
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
