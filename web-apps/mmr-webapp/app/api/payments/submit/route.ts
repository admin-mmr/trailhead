import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { pool } from '@/lib/db/connection'
import { findOrCreateMember } from '@/lib/db/members'
import { sendEmail } from '@/lib/email/client'
import { nanoid } from 'nanoid'

// ── Validation schema ───────────────────────────────────────────────────────
const SubmitSchema = z.object({
  // Membership plan
  plan: z.enum(['individual', 'family', 'family_upgrade']),
  amount: z.number().positive(),
  paymentMethod: z.enum(['zelle', 'venmo']),

  // Member info
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  email: z.string().email(),
  phone: z.string().min(7),
  address: z.string().min(1),
  city: z.string().min(1),
  state: z.string().min(2),
  zip: z.string().min(5),
  dateOfBirth: z.string().min(1),
  emergencyName: z.string().min(1),
  emergencyPhone: z.string().min(7),
  nyrrId: z.string().optional(),
  shirtSize: z.string().optional(),
  pronouns: z.string().optional(),

  // Payment declaration
  payerName: z.string().min(1),
  paymentDate: z.string().min(1),
  memoField: z.string().optional(),
  last4: z.string().max(4).optional(),
})

// ── Plan → PaymentIntent label ───────────────────────────────────────────────
const PLAN_INTENT: Record<string, string> = {
  individual: 'Individual Membership',
  family: 'Family Membership',
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
      email: d.email,
      firstName: d.firstName,
      lastName: d.lastName,
      phone: d.phone,
      address: d.address,
      city: d.city,
      state: d.state,
      zip: d.zip,
      dateOfBirth: d.dateOfBirth,
      emergencyName: d.emergencyName,
      emergencyPhone: d.emergencyPhone,
      nyrrId: d.nyrrId,
      shirtSize: d.shirtSize,
      pronouns: d.pronouns,
    })

    // 2. Generate unique event ID (e.g. EVT-20250101-ABC12)
    const today = new Date().toISOString().slice(0, 10).replace(/-/g, '')
    const eventId = `EVT-${today}-${nanoid(5).toUpperCase()}`

    // 3. Insert payment_events row with Status='Pending'
    const conn = await pool.getConnection()
    try {
      await conn.execute(
        `INSERT INTO payment_events
          (event_id, member_id, email, payment_intent, amount, payment_method,
           payer_name, payment_date, memo_field, last4_digits, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Pending', NOW())`,
        [
          eventId,
          member.memberId,
          d.email,
          PLAN_INTENT[d.plan],
          d.amount,
          d.paymentMethod,
          d.payerName,
          d.paymentDate,
          d.memoField ?? '',
          d.last4 ?? '',
        ]
      )
    } finally {
      conn.release()
    }

    // 4. Send confirmation email to member
    try {
      await sendEmail({
        to: d.email,
        subject: 'MMR Membership Application Received',
        html: `
          <p>Hi ${d.firstName},</p>
          <p>We received your membership application for <strong>${PLAN_INTENT[d.plan]}</strong> ($${d.amount}).</p>
          <p>Your reference number is: <strong>${eventId}</strong></p>
          <p>Our team will verify your ${d.paymentMethod} payment and activate your membership within 1–2 business days.
             You'll receive another email once your membership is active.</p>
          <p>If you haven't already, please log in to your member portal to upload a screenshot of your payment.
             This helps us process your application faster.</p>
          <p>Thank you for joining Misty Mountain Runners!</p>
          <p>— The MMR Team</p>
        `,
      })
    } catch (emailErr) {
      // Non-fatal: log but don't fail the request
      console.error('[payments/submit] Email send failed:', emailErr)
    }

    return NextResponse.json({ eventId, memberId: member.memberId }, { status: 201 })
  } catch (err) {
    console.error('[payments/submit] Error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
