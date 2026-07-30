import { NextRequest, NextResponse } from 'next/server'
import { authorizeJobRequest } from '@/lib/jobs/auth'
import { runRenewalReminders } from '@/lib/notifications/renewal-reminders'

export const dynamic = 'force-dynamic'
// Reminder runs walk hundreds of members and make one webhook call each, which
// takes far longer than the default serverless budget.
export const maxDuration = 300

/**
 * POST /api/jobs/renewal-reminders
 *
 * The weekly renewal reminder job, triggered by
 * .github/workflows/renewal-reminders.yml. Azure Static Web Apps has no
 * scheduler, so the cron lives in GitHub Actions and authenticates with the
 * shared JOB_SECRET — this route has NO member session.
 *
 * Body (optional): { "dryRun": true, "limit": 5 }
 *   dryRun — count what would be sent, claim nothing, send nothing
 *   limit  — override config.RenewalReminderMaxPerRun for one run
 *
 * Safe to re-run at any time: every send is claimed in notification_log first,
 * so a duplicate trigger sends nothing. See lib/notifications/renewal-reminders.ts
 * for the cadence and the reasoning behind the per-run cap.
 *
 * ⚠️ Deliberately NOT wrapped in withApiHandler: this route must answer the cron
 * with a machine-readable body on every path, including auth failures, and must
 * never redirect to /login the way session-gated routes do.
 */
export async function POST(req: NextRequest) {
  const auth = authorizeJobRequest(req)
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: auth.message }, { status: auth.status })
  }

  const options = await parseOptions(req)

  try {
    const result = await runRenewalReminders(options)
    // A run that sent nothing is normal (no member in a band, or all already
    // claimed), so this is a 200 with counts rather than an error.
    return NextResponse.json({ ok: true, data: result })
  } catch (err) {
    console.error('[renewal-reminders] run failed:', err)
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'Reminder run failed' },
      { status: 500 },
    )
  }
}

/**
 * A malformed or absent body is not an error — the cron posts no body at all.
 * Only explicitly valid values are honoured.
 */
async function parseOptions(req: NextRequest): Promise<{ dryRun?: boolean; limit?: number }> {
  try {
    const body = await req.json()
    if (!body || typeof body !== 'object') return {}
    const options: { dryRun?: boolean; limit?: number } = {}
    if (body.dryRun === true) options.dryRun = true
    if (typeof body.limit === 'number' && Number.isFinite(body.limit) && body.limit > 0) {
      options.limit = Math.floor(body.limit)
    }
    return options
  } catch {
    return {}
  }
}
