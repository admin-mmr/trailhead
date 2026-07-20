import { NextRequest, NextResponse } from 'next/server'
import type Stripe from 'stripe'
import { pool } from '@/lib/db/connection'
import { getStripe } from '@/lib/stripe'

// ── POST /api/stripe/webhook ────────────────────────────────────────────────
// Unauthenticated by design — requests are verified via the Stripe signature.
// On checkout.session.completed, inserts a payments row. The existing DB
// triggers then activate the member (trg_payments_sync_membership_only) and
// approve the submission (trg_payments_approve_submission), exactly as a
// Gmail-matched payment would.
export async function POST(req: NextRequest) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET
  if (!secret) {
    console.error('[stripe/webhook] STRIPE_WEBHOOK_SECRET is not set')
    return NextResponse.json({ error: 'Webhook not configured' }, { status: 500 })
  }

  const signature = req.headers.get('stripe-signature')
  if (!signature) {
    return NextResponse.json({ error: 'Missing signature' }, { status: 400 })
  }

  let event: Stripe.Event
  try {
    const rawBody = await req.text()
    event = getStripe().webhooks.constructEvent(rawBody, signature, secret)
  } catch (err) {
    console.error('[stripe/webhook] Signature verification failed:', err)
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 })
  }

  if (event.type !== 'checkout.session.completed') {
    return NextResponse.json({ received: true })
  }

  const session = event.data.object as Stripe.Checkout.Session
  if (session.payment_status !== 'paid') {
    // e.g. delayed payment methods — a later async event confirms these
    return NextResponse.json({ received: true })
  }

  // PaymentIntent id doubles as PaymentID → PK collision makes retries idempotent
  const paymentId =
    typeof session.payment_intent === 'string'
      ? session.payment_intent
      : session.payment_intent?.id ?? session.id
  const memberId     = session.metadata?.memberId || null
  const submissionId = session.metadata?.submissionId || null
  const paymentType  = session.metadata?.paymentType || null
  const amount       = (session.amount_total ?? 0) / 100
  const payerName    = session.customer_details?.name ?? null
  const payerEmail   = session.customer_details?.email ?? null

  try {
    const conn = await pool.getConnection()
    try {
      // TransactionNumber stays NULL: this payment has no gmail_transactions row,
      // which correctly skips the auto-fill and split-limit triggers.
      await conn.execute(
        `INSERT INTO payments
           (PaymentID, MemberID, PaymentDate, Amount, PaymentMethod, PayerName,
            MemoField, ProcessedBy, Source, Notes, SubmissionID, PaymentType)
         VALUES (?, ?, CURDATE(), ?, 'Stripe', ?, ?, 'stripe-webhook', 'stripe', ?, ?, ?)`,
        [
          paymentId,
          memberId,
          amount,
          payerName,
          `Stripe Checkout ${session.id}`,
          `Stripe test-mode payment. payment_intent=${paymentId}` +
            (payerEmail ? `; payer email=${payerEmail}` : ''),
          submissionId,
          paymentType,
        ]
      )
    } finally {
      conn.release()
    }
  } catch (err: any) {
    if (err?.code === 'ER_DUP_ENTRY') {
      // Stripe retried an event we already recorded — done
      return NextResponse.json({ received: true, duplicate: true })
    }
    console.error('[stripe/webhook] Failed to record payment:', err)
    // Non-2xx → Stripe retries with backoff
    return NextResponse.json({ error: 'Failed to record payment' }, { status: 500 })
  }

  return NextResponse.json({ received: true })
}
