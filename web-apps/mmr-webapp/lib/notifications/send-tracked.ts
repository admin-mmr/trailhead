/**
 * send-tracked.ts — send one email, exactly once, and record what happened.
 *
 * Wraps the claim/send/settle dance from lib/db/notifications.ts so callers
 * cannot get the ordering wrong. Returns an outcome rather than throwing,
 * because every caller is a batch job or a post-commit hook where one bad
 * address must not abort the rest of the work.
 */

import { sendEmail, ADMIN_CC } from '../email/client'
import { claimNotification, markFailed, markSent, logNotification } from '../db/notifications'
import type { EmailType } from '../email/registry'

export type SendOutcome =
  | { status: 'sent' }
  | { status: 'skipped'; reason: 'already_sent' | 'no_recipient' }
  | { status: 'failed'; error: string }

export interface TrackedSendInput {
  to:        string | null | undefined
  subject:   string
  html:      string
  emailType: EmailType
  memberId:  string | null
  stage?:    string | null
  /**
   * Omit for transactional mail that should go out every time it is earned
   * (receipts). Provide it for anything a scheduled job might retry.
   */
  dedupeKey?: string
  /** Send the club a copy. On by default, matching the other membership mail. */
  ccAdmin?:   boolean
}

export async function sendTracked(input: TrackedSendInput): Promise<SendOutcome> {
  const to = input.to?.trim()
  if (!to) {
    await logNotification({
      memberId:  input.memberId,
      emailType: input.emailType,
      stage:     input.stage ?? null,
      recipient: '(none)',
      subject:   input.subject,
      status:    'skipped',
      error:     'No recipient address on member record',
    })
    return { status: 'skipped', reason: 'no_recipient' }
  }

  const common = {
    to,
    subject:   input.subject,
    html:      input.html,
    cc:        input.ccAdmin === false ? undefined : ADMIN_CC,
    emailType: input.emailType,
    memberId:  input.memberId ?? undefined,
  }

  // No dedupe key: transactional mail. Send, then log for the audit trail.
  if (!input.dedupeKey) {
    try {
      await sendEmail(common)
      await logNotification({
        memberId:  input.memberId,
        emailType: input.emailType,
        stage:     input.stage ?? null,
        recipient: to,
        subject:   input.subject,
        status:    'sent',
      })
      return { status: 'sent' }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      await logNotification({
        memberId:  input.memberId,
        emailType: input.emailType,
        stage:     input.stage ?? null,
        recipient: to,
        subject:   input.subject,
        status:    'failed',
        error:     message,
      })
      return { status: 'failed', error: message }
    }
  }

  // Deduped mail: claim first, so two overlapping runs cannot both send.
  const claim = await claimNotification({
    memberId:  input.memberId,
    emailType: input.emailType,
    stage:     input.stage ?? null,
    dedupeKey: input.dedupeKey,
    recipient: to,
    subject:   input.subject,
  })
  if (!claim) return { status: 'skipped', reason: 'already_sent' }

  try {
    await sendEmail(common)
    await markSent(claim.id)
    return { status: 'sent' }
  } catch (err) {
    // Releases the claim (dedupe_key → NULL) so the next run retries.
    await markFailed(claim.id, err)
    return { status: 'failed', error: err instanceof Error ? err.message : String(err) }
  }
}
