/**
 * renewal-reminders.ts — the weekly reminder job body.
 *
 * Kept out of the route handler so it can be tested without HTTP and run from a
 * script if the cron is ever unavailable.
 *
 * Shape of a run:
 *   1. bail out unless config.RenewalRemindersEnabled is '1' (kill switch that
 *      needs no deploy — useful the week someone notices the copy is wrong)
 *   2. load every member whose expiration falls in the widest reminder band
 *   3. resolve each member's stage from days-to-expiration (NY time)
 *   4. for family memberships, attach the roster so the mail can say who else
 *      lapses — one renewal covers them all
 *   5. send through sendTracked, which claims a notification_log row first and
 *      so makes the whole job idempotent
 *   6. stop at config.RenewalReminderMaxPerRun
 *
 * ⚠️ Why the cap matters: every one of the 408 active members currently shares
 * the same expiration date, so a reminder band opens for all of them in the same
 * week. All club mail goes out through the GAS webhook on top of Gmail, which
 * has a hard daily send quota — an uncapped run would hit it and fail the tail
 * of the list. Capped runs simply continue next week: the members skipped this
 * run are still in the band (every band is at least 15 days wide), and the ones
 * already mailed are claimed, so the job naturally drains the backlog. A run
 * that hits the cap says so in its result.
 */

import { getConfigValue } from '../db/config'
import { getFamilyRoster, getMembersDueForReminder, type RenewalCandidate } from '../db/renewals'
import { renewalReminderEmailHtml } from '../email/templates'
import { EMAIL_TYPES } from '../email/registry'
import { formatLongDate } from '../date'
import { todayInNY, type CivilDate } from '../membership/expiration'
import {
  REMINDER_MAX_DAYS,
  REMINDER_MIN_DAYS,
  reminderDedupeKey,
  stageFor,
  type RenewalStageDef,
} from '../membership/renewal-stages'
import { sendTracked } from './send-tracked'

export interface ReminderRunResult {
  ranAt:      string
  enabled:    boolean
  dryRun:     boolean
  considered: number
  sent:       number
  skipped:    number
  failed:     number
  /** True when the per-run cap stopped the run before the list was exhausted. */
  cappedAt:   number | null
  byStage:    Record<string, number>
  errors:     string[]
}

export interface ReminderRunOptions {
  /** Report what would be sent without sending or claiming anything. */
  dryRun?: boolean
  /** Overrides config.RenewalReminderMaxPerRun — used by tests. */
  limit?:  number
  today?:  CivilDate
}

export async function runRenewalReminders(
  options: ReminderRunOptions = {},
): Promise<ReminderRunResult> {
  const today  = options.today ?? todayInNY()
  const dryRun = options.dryRun === true

  const result: ReminderRunResult = {
    ranAt: today, enabled: true, dryRun,
    considered: 0, sent: 0, skipped: 0, failed: 0,
    cappedAt: null, byStage: {}, errors: [],
  }

  const enabled = (await getConfigValue('RenewalRemindersEnabled', '1')) === '1'
  if (!enabled) {
    result.enabled = false
    return result
  }

  const limit = options.limit ?? Number(await getConfigValue('RenewalReminderMaxPerRun', '150'))
  const candidates = await getMembersDueForReminder(REMINDER_MIN_DAYS, REMINDER_MAX_DAYS, today)
  result.considered = candidates.length

  // One roster lookup per family, not per member — a family of four would
  // otherwise run the same query four times.
  const rosterCache = new Map<string, string[]>()

  for (const member of candidates) {
    if (result.sent >= limit) {
      result.cappedAt = limit
      break
    }

    const stage = stageFor(member.daysLeft)
    if (!stage) continue // outside every band — nothing to say

    const familyMembers = member.familyId
      ? await familyNames(member.familyId, rosterCache)
      : undefined

    if (dryRun) {
      result.sent += 1
      result.byStage[stage.stage] = (result.byStage[stage.stage] ?? 0) + 1
      continue
    }

    const outcome = await sendTracked({
      to:        member.email,
      subject:   reminderSubject(stage, member),
      html:      renewalReminderEmailHtml({
        firstName: member.firstName,
        memberId:  member.memberId,
        expiresAt: member.expiration,
        daysLeft:  member.daysLeft,
        stage:     stage.stage,
        planLabel: planLabel(member),
        familyMembers,
      }),
      emailType: EMAIL_TYPES.renewal_reminder,
      memberId:  member.memberId,
      stage:     stage.stage,
      dedupeKey: reminderDedupeKey(member.memberId, member.expiration, stage.stage),
      // Reminders are a campaign, not a transaction: 400 CCs would bury the
      // admin inbox, and the send is recorded in notification_log anyway.
      ccAdmin:   false,
    })

    if (outcome.status === 'sent') {
      result.sent += 1
      result.byStage[stage.stage] = (result.byStage[stage.stage] ?? 0) + 1
    } else if (outcome.status === 'skipped') {
      result.skipped += 1
    } else {
      result.failed += 1
      // Cap the error list — one broken address should not produce a 400-line
      // response body.
      if (result.errors.length < 20) {
        result.errors.push(`${member.memberId}: ${outcome.error}`)
      }
    }
  }

  return result
}

async function familyNames(
  familyId: string,
  cache: Map<string, string[]>,
): Promise<string[] | undefined> {
  const cached = cache.get(familyId)
  if (cached) return cached.length > 1 ? cached : undefined

  const roster = await getFamilyRoster(familyId)
  const names = roster.map((m) => `${m.firstName} ${m.lastName}`.trim())
  cache.set(familyId, names)
  return names.length > 1 ? names : undefined
}

function planLabel(member: RenewalCandidate): string {
  return member.type?.toLowerCase() === 'family' ? 'Family Membership' : 'Individual Membership'
}

function reminderSubject(stage: RenewalStageDef, member: RenewalCandidate): string {
  const when = formatLongDate(member.expiration)
  switch (stage.stage) {
    case 'T60':
      return `Renewal is open — your MMR membership expires ${when}`
    case 'T30':
      return `Your MMR membership expires in about a month (${when})`
    case 'T7':
      return member.daysLeft === 0
        ? 'Your MMR membership expires today'
        : `Your MMR membership expires ${when} — renew this week`
    case 'LAPSED_14':
      return 'Your MMR membership has expired — renew to restore access'
    case 'FINAL_45':
      return 'Final reminder: your MMR membership has expired'
  }
}
