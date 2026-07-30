import { NextRequest, NextResponse } from 'next/server'
import { authorizeJobRequest } from '@/lib/jobs/auth'
import { notifyFamilyRosterChange } from '@/lib/notifications/family'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

/**
 * POST /api/notifications/family-updated
 *
 * Body: { familyId: string, addedMemberIds?: string[], dedupeSuffix?: string }
 *
 * Emails every member of a family the full grouped roster after the family
 * changed. Called by the Flask admin (api_members_family.py,
 * api_members_family_ops.py) — family grouping lives there, while the email
 * templates live here, and duplicating bilingual HTML into Python would
 * guarantee the two drifted.
 *
 * Auth is the shared JOB_SECRET, not a member session. No member can reach this:
 * a member cannot be trusted to name an arbitrary familyId, since the response
 * would confirm how many people are in someone else's household.
 *
 * `dedupeSuffix` makes a retry safe. Callers should pass something stable for
 * the operation (e.g. 'add-A0123-20260730'); omit it to force a resend.
 */
export async function POST(req: NextRequest) {
  const auth = authorizeJobRequest(req)
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: auth.message }, { status: auth.status })
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON body' }, { status: 400 })
  }

  const parsed = parseBody(body)
  if ('error' in parsed) {
    return NextResponse.json({ ok: false, error: parsed.error }, { status: 400 })
  }

  try {
    const result = await notifyFamilyRosterChange(parsed)
    // recipients === 0 means the familyId matched nobody. That is a caller bug
    // worth surfacing, not a silent success.
    if (result.recipients === 0) {
      return NextResponse.json(
        { ok: false, error: `No members found for familyId ${parsed.familyId}` },
        { status: 404 },
      )
    }
    return NextResponse.json({ ok: true, data: result })
  } catch (err) {
    console.error('[family-updated] failed:', err)
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'Notification failed' },
      { status: 500 },
    )
  }
}

type ParsedBody =
  | { familyId: string; addedMemberIds: string[]; dedupeSuffix?: string }
  | { error: string }

function parseBody(body: unknown): ParsedBody {
  if (!body || typeof body !== 'object') return { error: 'Body must be an object' }
  const b = body as Record<string, unknown>

  const familyId = typeof b.familyId === 'string' ? b.familyId.trim() : ''
  if (!familyId) return { error: 'familyId is required' }

  const rawAdded = b.addedMemberIds
  if (rawAdded !== undefined && !Array.isArray(rawAdded)) {
    return { error: 'addedMemberIds must be an array of member IDs' }
  }
  const addedMemberIds = (rawAdded ?? [])
    .filter((v): v is string => typeof v === 'string')
    .map((v) => v.trim())
    .filter(Boolean)

  const dedupeSuffix =
    typeof b.dedupeSuffix === 'string' && b.dedupeSuffix.trim() !== ''
      ? b.dedupeSuffix.trim()
      : undefined

  return { familyId, addedMemberIds, dedupeSuffix }
}
