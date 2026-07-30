import { NextRequest, NextResponse } from 'next/server'
import { requireActiveMember } from '@/lib/auth/session'
import { isAdmin } from '@/lib/db/admins'
import { EMAIL_TEMPLATE_PREVIEWS, findTemplatePreview } from '@/lib/email/registry'

export const dynamic = 'force-dynamic'

/**
 * GET /api/admin/email-preview            → index of every template
 * GET /api/admin/email-preview?id=welcome → that template, rendered as HTML
 *
 * Lets the club read every member-facing email before it goes out, which is the
 * practical half of "how do we manage templates": the copy lives in reviewable
 * TypeScript, and this is how a non-developer sees the result.
 *
 * Rendered with SAMPLE data only (lib/email/registry.ts) — it never touches a
 * real member's record, so previewing is safe and sends nothing. Admin-gated all
 * the same, since the templates disclose club branding and internal flow.
 *
 * Deliberately an API route rather than a page: this webapp has no admin UI shell
 * (the admin app is Flask), and a rendered email must be served as a standalone
 * HTML document anyway — it carries its own <html>/<body> from lib/email/_layout.
 */
export async function GET(req: NextRequest) {
  try {
    const session = await requireActiveMember()
    if (!(await isAdmin(session.email))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const id = req.nextUrl.searchParams.get('id')
    if (!id) return NextResponse.json({ ok: true, data: indexPayload() })

    const template = findTemplatePreview(id)
    if (!template) {
      return NextResponse.json(
        { error: `Unknown template '${id}'`, available: EMAIL_TEMPLATE_PREVIEWS.map((t) => t.id) },
        { status: 404 },
      )
    }

    // The subject is not part of the HTML body, so it is surfaced in a header —
    // reviewing copy without seeing the subject line misses half the message.
    return new NextResponse(template.render(), {
      status: 200,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'X-Email-Subject': encodeURIComponent(template.subject),
        // Never let a preview be cached and served to a non-admin later.
        'Cache-Control': 'no-store',
      },
    })
  } catch (err) {
    const e = err as { status?: number; message?: string }
    if (e.status === 401 || e.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (e.status === 403 || e.message === 'Active membership required') {
      return NextResponse.json({ error: 'Active membership required' }, { status: 403 })
    }
    console.error('[api/admin/email-preview] error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

function indexPayload() {
  return {
    count: EMAIL_TEMPLATE_PREVIEWS.length,
    templates: EMAIL_TEMPLATE_PREVIEWS.map((t) => ({
      id:          t.id,
      emailType:   t.emailType,
      label:       t.label,
      description: t.description,
      subject:     t.subject,
      previewUrl:  `/api/admin/email-preview?id=${encodeURIComponent(t.id)}`,
    })),
  }
}
