/**
 * family.ts — the two notifications that go to a whole household.
 *
 * Both fan out over the family roster and send one personalised copy per member,
 * rather than one email with everyone in the To: line. That is deliberate:
 *   • each member's copy marks THEM in the roster ("you")
 *   • members' addresses are never disclosed to each other
 *   • one bad address fails one send, not the whole batch
 *
 * Neither function throws. They are called after a payment has already been
 * banked or a family regrouping has already been committed, so a mail failure
 * must never look like the operation failed.
 */

import { getFamilyRoster, getFamilyRosterForMember, type FamilyMemberRow } from '../db/renewals'
import { familyRenewalEmailHtml, familyMemberAddedEmailHtml } from '../email/templates'
import { EMAIL_TYPES } from '../email/registry'
import { sendTracked } from './send-tracked'
import type { FamilyRosterEntry } from '../email/templates/family'

export interface FamilyNotifyResult {
  recipients: number
  sent:       number
  skipped:    number
  failed:     number
  errors:     string[]
}

const empty = (): FamilyNotifyResult => ({
  recipients: 0, sent: 0, skipped: 0, failed: 0, errors: [],
})

/**
 * Tell every member of a family that their shared membership was renewed.
 *
 * Called after the payment webhook commits, so the roster already carries the
 * new expiration the trigger cascaded.
 *
 * `dedupeSuffix` should identify the payment (the Stripe PaymentIntent, say), so
 * a webhook Stripe retries cannot mail the household twice — while a genuine
 * second renewal later still gets through.
 */
export async function notifyFamilyRenewal(params: {
  /** Any member of the family — normally whoever paid. */
  payerMemberId: string
  expiresAt:     string
  planLabel?:    string
  dedupeSuffix?: string
  testMode?:     boolean
  /** Skip the payer, who is getting a receipt with the same information. */
  skipPayer?:    boolean
}): Promise<FamilyNotifyResult> {
  const result = empty()
  try {
    const roster = await getFamilyRosterForMember(params.payerMemberId)
    // A single-member "family" is just an individual membership; the payment
    // receipt already told them everything this email would.
    if (roster.length < 2) return result

    const payer = roster.find((m) => m.memberId === params.payerMemberId)
    const payerName = payer ? `${payer.firstName} ${payer.lastName}`.trim() : undefined

    const audience = params.skipPayer
      ? roster.filter((m) => m.memberId !== params.payerMemberId)
      : roster

    for (const member of audience) {
      result.recipients += 1
      const outcome = await sendTracked({
        to:        member.email,
        subject:   'Your MMR family membership is renewed',
        html:      familyRenewalEmailHtml({
          firstName:  member.firstName,
          expiresAt:  params.expiresAt,
          members:    toRosterEntries(roster, member.memberId),
          paidByName: payerName,
          planLabel:  params.planLabel,
          testMode:   params.testMode,
        }),
        emailType: EMAIL_TYPES.family_renewal,
        memberId:  member.memberId,
        dedupeKey: params.dedupeSuffix
          ? `family_renewal:${member.memberId}:${params.dedupeSuffix}`
          : undefined,
      })
      tally(result, member.memberId, outcome)
    }
  } catch (err) {
    // Deliberately swallowed — see the file header.
    console.error('[family-notify] renewal fan-out failed:', err)
    result.errors.push(err instanceof Error ? err.message : String(err))
  }
  return result
}

/**
 * Tell every member of a family that the roster changed, with the full grouped
 * list. The newly added members are flagged, and they are notified too — their
 * copy is how they learn which household they were put in.
 */
export async function notifyFamilyRosterChange(params: {
  familyId:       string
  /** MemberIDs added in this change. Flagged NEW in the roster block. */
  addedMemberIds: string[]
  dedupeSuffix?:  string
}): Promise<FamilyNotifyResult> {
  const result = empty()
  try {
    const roster = await getFamilyRoster(params.familyId)
    if (roster.length === 0) return result

    const added = new Set(params.addedMemberIds)
    const addedNames = roster
      .filter((m) => added.has(m.memberId))
      .map((m) => `${m.firstName} ${m.lastName}`.trim())

    // The shared expiration. Families are kept in sync by the payments trigger,
    // but a regrouping can briefly leave them mixed — showing the LATEST would
    // promise coverage a member does not have, so mixed dates show none at all.
    const expirations = Array.from(
      new Set(roster.map((m) => m.expiration).filter((e): e is string => Boolean(e))),
    )
    const sharedExpiration = expirations.length === 1 ? expirations[0] : undefined

    for (const member of roster) {
      result.recipients += 1
      const outcome = await sendTracked({
        to:        member.email,
        subject:   addedNames.length > 0
          ? `${addedNames.join(' and ')} ${addedNames.length > 1 ? 'were' : 'was'} added to your MMR family membership`
          : 'Your MMR family membership was updated',
        html:      familyMemberAddedEmailHtml({
          firstName:  member.firstName,
          members:    toRosterEntries(roster, member.memberId, added),
          addedNames,
          expiresAt:  sharedExpiration ?? undefined,
          familyId:   params.familyId,
        }),
        emailType: EMAIL_TYPES.family_member_added,
        memberId:  member.memberId,
        dedupeKey: params.dedupeSuffix
          ? `family_added:${member.memberId}:${params.dedupeSuffix}`
          : undefined,
      })
      tally(result, member.memberId, outcome)
    }
  } catch (err) {
    console.error('[family-notify] roster fan-out failed:', err)
    result.errors.push(err instanceof Error ? err.message : String(err))
  }
  return result
}

function toRosterEntries(
  roster: FamilyMemberRow[],
  recipientId: string,
  added?: Set<string>,
): FamilyRosterEntry[] {
  return roster.map((m) => ({
    memberId:    m.memberId,
    firstName:   m.firstName,
    lastName:    m.lastName,
    isRecipient: m.memberId === recipientId,
    isNew:       added?.has(m.memberId) ?? false,
  }))
}

function tally(
  result: FamilyNotifyResult,
  memberId: string,
  outcome: { status: 'sent' | 'skipped' | 'failed'; error?: string },
): void {
  if (outcome.status === 'sent') result.sent += 1
  else if (outcome.status === 'skipped') result.skipped += 1
  else {
    result.failed += 1
    if (result.errors.length < 20) result.errors.push(`${memberId}: ${outcome.error}`)
  }
}
