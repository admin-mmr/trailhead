import { NextRequest, NextResponse } from 'next/server'
import { requireSession } from '@/lib/auth/session'
import { isAdmin, listAdmins, addAdmin, removeAdmin, SUPER_ADMIN_EMAIL } from '@/lib/db/admins'
import { sendEmail } from '@/lib/email/client'

/**
 * GET /api/admin — list all admins
 * Requires the caller to be an admin.
 */
export async function GET() {
  try {
    const session = await requireSession()
    if (!(await isAdmin(session.email))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    const admins = await listAdmins()
    return NextResponse.json({ ok: true, data: admins })
  } catch (err: any) {
    if (err.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('[api/admin] GET error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * POST /api/admin — add a new admin
 * Body: { email: string }
 * Requires the caller to be an admin.
 * Sends notification email to all existing admins.
 */
export async function POST(req: NextRequest) {
  try {
    const session = await requireSession()
    if (!(await isAdmin(session.email))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { email } = await req.json()
    if (!email || typeof email !== 'string' || !email.includes('@')) {
      return NextResponse.json({ error: 'Valid email is required' }, { status: 400 })
    }

    const added = await addAdmin(email, session.email)
    if (!added) {
      return NextResponse.json({ error: 'This email is already an admin.' }, { status: 409 })
    }

    // Notify all existing admins about the new addition
    try {
      const admins = await listAdmins()
      const callerName = [session.firstName, session.lastName].filter(Boolean).join(' ') || session.email
      for (const admin of admins) {
        await sendEmail({
          to:      admin.email,
          subject: `[MMR Admin] New admin added: ${email}`,
          html:    `
            <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
              <h2 style="color: #C8102E;">Admin Update — Misty Mountain Runners</h2>
              <p><strong>${callerName}</strong> (${session.email}) has added <strong>${email}</strong> as a new admin.</p>
              <p>If this was not authorized, please log in to the admin panel and remove this admin.</p>
              <hr style="border-color: #eee;" />
              <p style="font-size: 12px; color: #999;">Misty Mountain Runners · 岚山跑团</p>
            </div>
          `,
        })
      }
    } catch (emailErr) {
      console.error('[api/admin] Failed to send notification emails:', emailErr)
      // Non-fatal
    }

    return NextResponse.json({ ok: true, message: `${email} has been added as admin.` }, { status: 201 })
  } catch (err: any) {
    if (err.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('[api/admin] POST error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * DELETE /api/admin — remove an admin
 * Body: { email: string }
 * Requires the caller to be an admin.
 * Any admin can remove themselves or other admins, except the super admin.
 */
export async function DELETE(req: NextRequest) {
  try {
    const session = await requireSession()
    if (!(await isAdmin(session.email))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { email } = await req.json()
    if (!email || typeof email !== 'string') {
      return NextResponse.json({ error: 'Email is required' }, { status: 400 })
    }

    const result = await removeAdmin(email)
    if (!result.removed) {
      return NextResponse.json(
        { error: result.reason ?? 'Admin not found.' },
        { status: result.reason ? 403 : 404 }
      )
    }

    // Notify remaining admins
    try {
      const admins = await listAdmins()
      const callerName = [session.firstName, session.lastName].filter(Boolean).join(' ') || session.email
      for (const admin of admins) {
        await sendEmail({
          to:      admin.email,
          subject: `[MMR Admin] Admin removed: ${email}`,
          html:    `
            <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
              <h2 style="color: #C8102E;">Admin Update — Misty Mountain Runners</h2>
              <p><strong>${callerName}</strong> (${session.email}) has removed <strong>${email}</strong> from the admin list.</p>
              <hr style="border-color: #eee;" />
              <p style="font-size: 12px; color: #999;">Misty Mountain Runners · 岚山跑团</p>
            </div>
          `,
        })
      }
    } catch (emailErr) {
      console.error('[api/admin] Failed to send notification emails:', emailErr)
    }

    return NextResponse.json({ ok: true, message: `${email} has been removed from admins.` })
  } catch (err: any) {
    if (err.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('[api/admin] DELETE error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
