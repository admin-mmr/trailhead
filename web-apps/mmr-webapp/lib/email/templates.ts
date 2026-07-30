/**
 * templates.ts — Shared HTML email templates for MMR (barrel)
 *
 * Split by domain to stay under the file-size limit; import from here as before.
 *  - membership.ts — welcome / activation, renewal reminder, expiration repair
 *  - payments.ts   — application received, payment rejected/expired, auto-match
 *  - family.ts     — family renewal, member added to family (whole-household mail)
 *  - auth.ts       — password reset
 *  - _layout.ts    — shared wrapper (`wrap`) + brand constants
 *
 * registry.ts lists every template with sample data, which powers the admin
 * preview page and keeps the email_type vocabulary in one place.
 *
 * All templates: first-name greeting, portal CTA footer, bilingual (EN + 中文),
 * brand colours (#5c35a8 purple, #E86033 orange).
 */

export {
  welcomeEmailHtml,
  membershipActivatedEmailHtml,
  renewalReminderEmailHtml,
  expirationRepairedEmailHtml,
} from './templates/membership'

export {
  applicationReceivedEmailHtml,
  paymentConfirmationEmailHtml,
  paymentRejectedEmailHtml,
  paymentExpiredEmailHtml,
  autoMatchConfirmationEmailHtml,
} from './templates/payments'

export {
  familyRenewalEmailHtml,
  familyMemberAddedEmailHtml,
  familyRosterBlock,
  type FamilyRosterEntry,
} from './templates/family'

export { passwordResetEmailHtml } from './templates/auth'
