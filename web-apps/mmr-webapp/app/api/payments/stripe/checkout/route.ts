import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import type { RowDataPacket } from 'mysql2'
import { pool } from '@/lib/db/connection'
import { getStripe } from '@/lib/stripe'
import { getMembershipPrice } from '@/lib/db/config'

// ── Validation schema ───────────────────────────────────────────────────────
const CheckoutSchema = z.object({
  submissionId: z.string().min(1),
  email:        z.string().email().optional(),
})

// ── POST /api/payments/stripe/checkout ──────────────────────────────────────
// Creates a Stripe Checkout Session for an existing pending submission.
// Membership amounts are recomputed server-side from the config table
// (IndividualPrice / FamilyPrice / FamilyUpgradePrice); donation amounts
// come from the submissions row. Never from the client.
export async function POST(req: NextRequest) {
  try {
    const parsed = CheckoutSchema.safeParse(await req.json())
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid input', details: parsed.error.flatten() }, { status: 400 })
    }
    const { submissionId, email } = parsed.data

    const conn = await pool.getConnection()
    let rows: RowDataPacket[]
    try {
      ;[rows] = await conn.execute<RowDataPacket[]>(
        `SELECT SubmissionID, MemberID, Amount, PaymentIntent, SubmissionType, Status
         FROM submissions WHERE SubmissionID = ?`,
        [submissionId]
      )
    } finally {
      conn.release()
    }

    const sub = rows[0]
    if (!sub) {
      return NextResponse.json({ error: 'Submission not found' }, { status: 404 })
    }
    if (sub.Status !== 'pending') {
      return NextResponse.json({ error: `Submission is ${sub.Status}, not payable` }, { status: 409 })
    }

    const isDonation  = sub.SubmissionType === 'donation'
    const paymentType = sub.PaymentIntent ?? (isDonation ? 'Donation' : 'Membership')

    // Server-side amount derivation (P1k): config price for memberships,
    // submissions.Amount for variable-amount donations.
    const amount = isDonation
      ? Number(sub.Amount)
      : (await getMembershipPrice(paymentType)) ?? Number(sub.Amount)
    if (!Number.isFinite(amount) || amount <= 0) {
      return NextResponse.json({ error: 'Submission has no valid amount' }, { status: 400 })
    }

    const origin = process.env.NEXT_PUBLIC_APP_URL ?? new URL(req.url).origin
    const cancelPath = isDonation ? '/donate' : '/join'

    const session = await getStripe().checkout.sessions.create({
      mode: 'payment',
      line_items: [{
        quantity: 1,
        price_data: {
          currency:     'usd',
          unit_amount:  Math.round(amount * 100),
          product_data: { name: `MMR ${paymentType}` },
        },
      }],
      customer_email:      email,
      client_reference_id: submissionId,
      metadata: {
        submissionID: submissionId,
        memberID:     sub.MemberID ?? '',
        plan:         sub.SubmissionType ?? '',
        paymentType,
      },
      success_url: `${origin}/payment/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url:  `${origin}${cancelPath}?canceled=1`,
    })

    return NextResponse.json({ url: session.url })
  } catch (err) {
    console.error('[stripe/checkout] Error:', err)
    return NextResponse.json({ error: 'Could not start checkout. Please try again later.' }, { status: 500 })
  }
}
