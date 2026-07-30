/**
 * registry.ts — one list of every member-facing email the club sends.
 *
 * Why this exists. Templates were already split into typed functions per domain,
 * which is the right storage — reviewable in PRs, type-checked, no untrusted
 * HTML — but three things had no single home:
 *
 *   1. the `email_type` strings. They are written to notification_log and passed
 *      to the GAS webhook. A typo used to be invisible until someone queried the
 *      log and found a category that never existed. EMAIL_TYPES is now the only
 *      source, and notification_log.email_type documents the link.
 *   2. sample data. Every template needed hand-written arguments to be eyeballed,
 *      so in practice nobody eyeballed them.
 *   3. an answer to "what will this actually look like". The admin preview page
 *      renders straight from this list, so adding a template to the registry is
 *      what makes it previewable — no page edit needed.
 *
 * Adding a template: write the function in templates/, export it from
 * templates.ts, then add an entry here. The registry test asserts every
 * EMAIL_TYPES value has an entry, so a missing one fails CI rather than quietly
 * dropping out of the preview.
 */

import {
  welcomeEmailHtml,
  renewalReminderEmailHtml,
  expirationRepairedEmailHtml,
  applicationReceivedEmailHtml,
  paymentConfirmationEmailHtml,
  paymentRejectedEmailHtml,
  paymentExpiredEmailHtml,
  autoMatchConfirmationEmailHtml,
  familyRenewalEmailHtml,
  familyMemberAddedEmailHtml,
  passwordResetEmailHtml,
} from './templates'
import { RENEWAL_STAGES } from '../membership/renewal-stages'

/**
 * Every email_type we write to notification_log and send to the GAS webhook.
 * Keep the values stable — they are historical data once logged.
 */
export const EMAIL_TYPES = {
  welcome:                 'welcome',
  application_received:    'application_received',
  payment_confirmation:    'payment_confirmation',
  donation_receipt:        'donation_receipt',
  payment_rejected:        'payment_rejected',
  payment_expired:         'payment_expired',
  expiration_repaired:     'expiration_repaired',
  auto_match_confirmation: 'auto_match_confirmation',
  renewal_reminder:        'renewal_reminder',
  family_renewal:          'family_renewal',
  family_member_added:     'family_member_added',
  password_reset:          'password_reset',
} as const

export type EmailType = (typeof EMAIL_TYPES)[keyof typeof EMAIL_TYPES]

export interface TemplatePreview {
  /** Stable id used in the preview URL. */
  id:          string
  emailType:   EmailType
  label:       string
  /** When and why this goes out — shown above the preview. */
  description: string
  /** Example subject line; the real one is built in lib/email/client.ts. */
  subject:     string
  render:      () => string
}

// ── Sample data ──────────────────────────────────────────────────────────────
// Obviously fake, so a preview can never be mistaken for a real member's mail.

const SAMPLE = {
  firstName: 'Wei',
  memberId:  'A0123',
  expiresAt: '2028-03-31',
  paidOn:    '2027-03-02',
}

const SAMPLE_FAMILY = [
  { memberId: 'A0123', firstName: 'Wei',  lastName: 'Chen', isRecipient: true },
  { memberId: 'A0124', firstName: 'Mei',  lastName: 'Chen' },
  { memberId: 'A0210', firstName: 'Lily', lastName: 'Chen' },
]

/** One preview entry per reminder stage — the cadence is the thing to review. */
const reminderPreviews: TemplatePreview[] = RENEWAL_STAGES.map((s) => {
  // A representative day inside the band, so the copy reads naturally.
  const daysLeft = Math.round((s.minDays + s.maxDays) / 2)
  return {
    id:          `renewal_reminder_${s.stage.toLowerCase()}`,
    emailType:   EMAIL_TYPES.renewal_reminder,
    label:       `Renewal reminder — ${s.stage} (${s.label})`,
    description: `Weekly job, days-to-expiration ${s.minDays}…${s.maxDays}. Previewed at ${daysLeft} days.`,
    subject:     `MMR membership renewal — ${s.label}`,
    render: () =>
      renewalReminderEmailHtml({
        firstName: SAMPLE.firstName,
        memberId:  SAMPLE.memberId,
        expiresAt: SAMPLE.expiresAt,
        daysLeft,
        stage:     s.stage,
        planLabel: 'Family Membership',
        familyMembers: SAMPLE_FAMILY.map((m) => `${m.firstName} ${m.lastName}`),
      }),
  }
})

export const EMAIL_TEMPLATE_PREVIEWS: TemplatePreview[] = [
  {
    id:          'welcome',
    emailType:   EMAIL_TYPES.welcome,
    label:       'Welcome — new member activated',
    description: 'Sent when a payment activates a brand-new member with no password yet.',
    subject:     `Welcome to Misty Mountain Runners! 🎉 Your Member ID: ${SAMPLE.memberId}`,
    render: () =>
      welcomeEmailHtml({
        firstName: SAMPLE.firstName,
        memberId:  SAMPLE.memberId,
        expiresAt: SAMPLE.expiresAt,
        planLabel: 'Individual Membership',
        payment: {
          amount:        30,
          paymentMethod: 'Stripe',
          referenceId:   'pi_3SampleOnly000',
          paidOn:        SAMPLE.paidOn,
        },
        setPasswordUrl: '/auth/forgot-password?email=sample%40example.com',
      }),
  },
  ...reminderPreviews,
  {
    id:          'family_renewal',
    emailType:   EMAIL_TYPES.family_renewal,
    label:       'Family membership renewed (whole household)',
    description: 'Sent to EVERY family member after a family membership payment.',
    subject:     'Your MMR family membership is renewed',
    render: () =>
      familyRenewalEmailHtml({
        firstName:  SAMPLE.firstName,
        expiresAt:  SAMPLE.expiresAt,
        members:    SAMPLE_FAMILY,
        paidByName: 'Mei Chen',
        planLabel:  'Family Membership',
      }),
  },
  {
    id:          'family_member_added',
    emailType:   EMAIL_TYPES.family_member_added,
    label:       'Member added to family (whole household)',
    description: 'Sent to every family member — including the new one — when the roster changes.',
    subject:     'Your MMR family membership was updated',
    render: () =>
      familyMemberAddedEmailHtml({
        firstName:  SAMPLE.firstName,
        members:    SAMPLE_FAMILY.map((m) => (m.memberId === 'A0210' ? { ...m, isNew: true } : m)),
        addedNames: ['Lily Chen'],
        expiresAt:  SAMPLE.expiresAt,
        familyId:   'F0042',
      }),
  },
  {
    id:          'application_received',
    emailType:   EMAIL_TYPES.application_received,
    label:       'Application received (awaiting payment review)',
    description: 'Sent after a Zelle/Venmo submission, before an admin verifies it.',
    subject:     'MMR Membership Application Received — Ref SAMPLE-001',
    render: () =>
      applicationReceivedEmailHtml({
        firstName:     SAMPLE.firstName,
        planLabel:     'Individual Membership',
        amount:        30,
        paymentMethod: 'Zelle',
        referenceId:   'SAMPLE-001',
      }),
  },
  {
    id:          'payment_confirmation',
    emailType:   EMAIL_TYPES.payment_confirmation,
    label:       'Payment confirmation / receipt',
    description: 'Renewals, upgrades, and donations.',
    subject:     'MMR payment received — $30.00',
    render: () =>
      paymentConfirmationEmailHtml({
        firstName:     SAMPLE.firstName,
        amount:        30,
        paymentMethod: 'Stripe',
        referenceId:   'pi_3SampleOnly000',
        description:   'Individual Membership',
        paidOn:        SAMPLE.paidOn,
        expiresAt:     SAMPLE.expiresAt,
      }),
  },
  {
    id:          'payment_rejected',
    emailType:   EMAIL_TYPES.payment_rejected,
    label:       'Payment could not be verified',
    description: 'Admin rejected a submitted payment proof.',
    subject:     'MMR Payment Could Not Be Verified — Ref SAMPLE-001',
    render: () =>
      paymentRejectedEmailHtml({
        firstName:   SAMPLE.firstName,
        planLabel:   'Individual Membership',
        amount:      30,
        referenceId: 'SAMPLE-001',
        reason:      'We could not find a matching transfer for this reference.',
      }),
  },
  {
    id:          'payment_expired',
    emailType:   EMAIL_TYPES.payment_expired,
    label:       'Payment submission expired',
    description: 'Proof was not received within config.PaymentProofReviewDays.',
    subject:     '⏰ Your MMR payment submission has expired — Ref SAMPLE-001',
    render: () =>
      paymentExpiredEmailHtml({
        firstName:   SAMPLE.firstName,
        referenceId: 'SAMPLE-001',
        expiresAt:   SAMPLE.paidOn,
      }),
  },
  {
    id:          'auto_match_confirmation',
    emailType:   EMAIL_TYPES.auto_match_confirmation,
    label:       'Payment auto-matched',
    description: 'Autoguess linked a bank transaction to a pending submission.',
    subject:     '✅ Your MMR payment has been matched — Membership activated',
    render: () =>
      autoMatchConfirmationEmailHtml({
        firstName:     SAMPLE.firstName,
        memberId:      SAMPLE.memberId,
        paymentIntent: 'SAMPLE-TX-0001',
        expiresAt:     SAMPLE.expiresAt,
        amount:        30,
      }),
  },
  {
    id:          'expiration_repaired',
    emailType:   EMAIL_TYPES.expiration_repaired,
    label:       'Membership record corrected',
    description: 'Reconciliation moved a member’s expiration date.',
    subject:     'Your MMR membership record has been updated',
    render: () =>
      expirationRepairedEmailHtml({
        firstName: SAMPLE.firstName,
        memberId:  SAMPLE.memberId,
        expiresAt: SAMPLE.expiresAt,
        planLabel: 'Individual Membership',
      }),
  },
  {
    id:          'password_reset',
    emailType:   EMAIL_TYPES.password_reset,
    label:       'Password reset',
    description: 'Preview only — the real mail carries a live single-use token.',
    subject:     'Reset your MMR password',
    render: () =>
      passwordResetEmailHtml({
        firstName:  SAMPLE.firstName,
        resetUrl:   '/auth/reset-password?token=SAMPLE-TOKEN-NOT-VALID',
        expiryMins: 60,
      }),
  },
]

export function findTemplatePreview(id: string): TemplatePreview | undefined {
  return EMAIL_TEMPLATE_PREVIEWS.find((t) => t.id === id)
}
