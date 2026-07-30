/**
 * renewal-stages.ts — the renewal reminder cadence.
 *
 * Five stages, and every one of them is a DAY BAND rather than an exact day.
 * That is deliberate and load-bearing: the job runs weekly, so a stage defined
 * as "exactly 30 days out" would miss roughly six of every seven members. Every
 * band here is at least 15 days wide, so a weekly run cannot skip a member, and
 * the bands are contiguous — a member is in exactly one stage at any moment.
 *
 * Sending each stage at most once is NOT enforced here; it comes from the
 * UNIQUE dedupe_key in notification_log ('renewal:<id>:<expiration>:<stage>').
 * That key includes the expiration date, so renewing resets the cycle for free.
 *
 * Deliberately NOT a backfill: a member who was unreachable during the T60 band
 * and first appears in T30 gets the T30 message only. Telling someone they have
 * 60 days left when they have 30 would be worse than saying nothing.
 */

export const RENEWAL_STAGES = [
  {
    stage: 'T60',
    /** Inclusive band on days-until-expiration. */
    minDays: 46,
    maxDays: 75,
    tone: 'heads-up',
    /** Roughly what the member is told, used for subject lines and previews. */
    label: 'Renewal window is open',
    labelZh: '会员续费已开放',
  },
  {
    stage: 'T30',
    minDays: 15,
    maxDays: 45,
    tone: 'reminder',
    label: 'About a month left',
    labelZh: '会员即将到期（约一个月）',
  },
  {
    stage: 'T7',
    minDays: 0,
    maxDays: 14,
    tone: 'urgent',
    label: 'Expires this week',
    labelZh: '会员本周到期',
  },
  {
    stage: 'LAPSED_14',
    minDays: -21,
    maxDays: -1,
    tone: 'lapsed',
    label: 'Membership has lapsed',
    labelZh: '会员已过期',
  },
  {
    stage: 'FINAL_45',
    minDays: -75,
    maxDays: -22,
    tone: 'final',
    label: 'Final renewal notice',
    labelZh: '最后一次续费提醒',
  },
] as const

export type RenewalStage = (typeof RENEWAL_STAGES)[number]['stage']
export type RenewalStageDef = (typeof RENEWAL_STAGES)[number]

/** The widest window the job ever has to query, derived — never hardcoded. */
export const REMINDER_MIN_DAYS = Math.min(...RENEWAL_STAGES.map((s) => s.minDays))
export const REMINDER_MAX_DAYS = Math.max(...RENEWAL_STAGES.map((s) => s.maxDays))

/**
 * The stage a member is in, or null when they are outside every band —
 * more than 75 days out (too early to nag) or more than 75 days lapsed
 * (they have had five notices; stop emailing them).
 */
export function stageFor(daysLeft: number): RenewalStageDef | null {
  if (!Number.isFinite(daysLeft)) return null
  const day = Math.trunc(daysLeft)
  return (
    RENEWAL_STAGES.find((s) => day >= s.minDays && day <= s.maxDays) ?? null
  )
}

export function stageDef(stage: RenewalStage): RenewalStageDef {
  const found = RENEWAL_STAGES.find((s) => s.stage === stage)
  if (!found) throw new Error(`Unknown renewal stage: ${stage}`)
  return found
}

/**
 * The idempotency key for one reminder. Includes the expiration date so that a
 * renewal — which changes that date — starts a clean cycle without any cleanup
 * of old log rows.
 */
export function reminderDedupeKey(
  memberId: string,
  expiration: string,
  stage: RenewalStage,
): string {
  return `renewal:${memberId}:${expiration}:${stage}`
}
