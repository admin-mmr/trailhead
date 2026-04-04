import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { pool } from '@/lib/db/connection'
import { findOrCreateMember } from '@/lib/db/members'
import { sendApplicationReceivedEmail } from '@/lib/email/client'
import { syncMemberToSheets, syncEventToSheets } from '@/lib/sheets/sync'
import { nanoid } from 'nanoid'

// ── Validation schema ───────────────────────────────────────────────────────
const SubmitSchema = z.object({
  // Membership plan
  plan: z.enum(['individual', 'family', 'family_upgrade']),
  amount: z.number().positive(),
  paymentMethod: z.enum(['zelle', 'venmo']),

  // Member info — no address / zip / emergency / shirt / pronouns
  firstName:      z.string().min(1),
  lastName:       z.string().min(1),
  email:          z.string().email(),
  phone:          z.string().min(7),
  wechatId:       z.string().optional(),
  district:       z.string().optional(),
  gender:         z.string().optional(),
  yearBorn:       z.preprocess(
    (val) => (val === '' || val === undefined || val === null) ? undefined : Number(val),
    z.number().int().optional(),
  ),
  nyrrRunnerName: z.string().optional(),

  // Payment declaration
  payerName:   z.string().min(1),
  paymentDate: z.string().min(1),
  memoField:   z.string().optional(),
  last4:       z.string().max(4).optional(),
})

// ── Plan → PaymentIntent label ───────────────────────────────────────────────
const PLAN_INTENT: Record<string, string> = {
  individual:     'Individual Membership',
  family:         'Family Membership',
  family_upgrade: 'Family Upgrade',
}

// ── POST /api/payments/submit ────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const parsed = SubmitSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid input', details: parsed.error.flatten() }, { status: 400 })
    }

    const d = parsed.data

    // 1. Find or create member record (idempotent by email)
    const member = await findOrCreateMember({
      email:          d.email,
      firstName:      d.firstName,
      lastName:       d.lastName,
      phone:          d.phone,
      wechatId:       d.wechatId,
      district:       d.district,
      gender:         d.gender,
      yearBorn:       d.yearBorn,
      nyrrRunnerName: d.nyrrRunnerName,
    })

    // 2. Generate unique submission ID (e.g. SUB-20250101-ABC12)
    const today   = new Date().toISOString().slice(0, 10).replace(/-/g, '')
    const submissionId = `SUB-${today}-${nanoid(5).toUpperCase()}`

    // 3. Calculate expiration date (14 days from now)
    const expiresAt = new Date()
    expiresAt.setDate(expiresAt.getDate() + 14)

    // 4. Insert submissions row with Status='pending'
    const conn = await pool.getConnection()
    try {
      await conn.execute(
        `INSERT INTO submissions
          (SubmissionID, MemberID, SubmissionType, Amount, PaymentIntent, PaymentMethod,
           PayerName, PaymentDate, MemoField, Last4Digits, ExpiresAt, Status)
         VALUES (?, ?, 'membership_payment', ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
        [
          submissionId,
          member.memberId,
          d.amount,
          PLAN_INTENT[d.plan],
          d.paymentMethod,
          d.payerName,
          d.paymentDate,
          d.memoField ?? null,
          d.last4     ?? null,
          expiresAt,
        ]
      )
    } finally {
      conn.release()
    }

    // 5. Send confirmation email to member
    try {
      await sendApplicationReceivedEmail({
        to:            d.email,
        firstName:     d.firstName,
        planLabel:     PLAN_INTENT[d.plan],
        amount:        d.amount,
        paymentMethod: d.paymentMethod,
        referenceId:   submissionId,
      })
    } catch (emailErr) {
      // Non-fatal: log but don't fail the request
      console.error('[payments/submit] Email send failed:', emailErr)
    }

    // 6. Sync to Google Sheets (non-fatal)
    // Note: Only sync member; submissions are no longer synced to Sheets
    try {
      await syncMemberToSheets(member)
    } catch (sheetErr) {
      console.error('[payments/submit] Sheets sync failed:', sheetErr)
    }

    return NextResponse.json({ submissionId, memberId: member.memberId }, { status: 201 })
  } catch (err: any) {
    console.error('[payments/submit] Error:', err)
    // Detect common DB errors for better user feedback
    const msg = err?.code === 'ER_DUP_ENTRY'
      ? 'A pending application already exists for this email. Please contact us if you need help.'
      : 'Internal server error. Please try again later.'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
