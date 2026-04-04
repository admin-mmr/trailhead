import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { pool } from '@/lib/db/connection'
import { nanoid } from 'nanoid'

// ── Validation schema ───────────────────────────────────────────────────────
const DonationSchema = z.object({
  amount:         z.number().positive(),
  paymentMethod:  z.enum(['zelle', 'venmo']),
  firstName:      z.string().min(1),
  lastName:       z.string().min(1),
  email:          z.string().email(),
  phone:          z.string().optional(),
  payerName:      z.string().min(1),
  paymentDate:    z.string().min(1),
  memoField:      z.string().optional(),
  last4:          z.string().max(4).optional(),
  memberId:       z.string().optional(),  // pre-filled if donor is a logged-in member
})

// ── POST /api/donations/submit ─────────────────────────────────────────────
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const parsed = DonationSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid input', details: parsed.error.flatten() }, { status: 400 })
    }

    const d = parsed.data

    // Generate unique submission ID (e.g. SUB-20260325-ABC12)
    const today   = new Date().toISOString().slice(0, 10).replace(/-/g, '')
    const submissionId = `SUB-${today}-${nanoid(5).toUpperCase()}`

    // Calculate expiration date (7 days for donations)
    const expiresAt = new Date()
    expiresAt.setDate(expiresAt.getDate() + 7)

    // Insert submissions row with SubmissionType='donation'
    const conn = await pool.getConnection()
    try {
      await conn.execute(
        `INSERT INTO submissions
          (SubmissionID, MemberID, SubmissionType, PaymentIntent, Amount, PaymentMethod,
           PayerName, PaymentDate, MemoField, Last4Digits, ExpiresAt, Status)
         VALUES (?, ?, 'donation', 'Donation', ?, ?, ?, ?, ?, ?, ?, 'pending')`,
        [
          submissionId,
          d.memberId ?? null,
          d.amount,
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

    return NextResponse.json({ submissionId, email: d.email }, { status: 201 })
  } catch (err) {
    console.error('[donations/submit] Error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
