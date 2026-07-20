import { NextRequest, NextResponse } from 'next/server'
import { createHash } from 'crypto'
import type Stripe from 'stripe'
import type { RowDataPacket } from 'mysql2'
import { pool } from '@/lib/db/connection'
import { getStripe } from '@/lib/stripe'
import { getMembershipPrice, MEMBERSHIP_PRICING } from '@/lib/db/config'

// ── POST /api/payments/stripe/webhook ───────────────────────────────────────
// Unauthenticated by design — requests are verified via the Stripe signature.
//
// P1k ledger pattern: on checkout.session.completed —
//   1. idempotency guard: INSERT into stripe_events (event_id PK)
//   2. verify amount_total against config (membership) / submission (donation)
//   3. INSERT a gmail_transactions ledger row (TransactionNumber = PaymentIntent id)
//   4. CALL sp_link_transaction → payments row → triggers activate member,
//      approve submission, and sync notes back to the ledger row
// Steps run in one DB transaction: any failure rolls everything back
// (including the idempotency row) so a Stripe retry starts clean.
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
  let payloadHash: string
  try {
    const rawBody = await req.text()
    event = getStripe().webhooks.constructEvent(rawBody, signature, secret)
    payloadHash = createHash('sha256').update(rawBody).digest('hex')
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

  const paymentIntentId =
    typeof session.payment_intent === 'string'
      ? session.payment_intent
      : session.payment_intent?.id ?? session.id
  const memberId     = session.metadata?.memberID || null
  const submissionId = session.metadata?.submissionID || null
  const paymentType  = session.metadata?.paymentType || 'Donation'
  const amountCents  = session.amount_total ?? 0
  const amount       = amountCents / 100
  const payerName    = session.customer_details?.name ?? null
  const payerEmail   = session.customer_details?.email ?? null

  // ── Amount verification (P1k: verify amount_total vs config) ─────────────
  const expectedCents = await expectedAmountCents(paymentType, submissionId)
  if (expectedCents != null && amountCents !== expectedCents) {
    console.error(
      `[stripe/webhook] Amount mismatch for ${event.id}: got ${amountCents}, expected ${expectedCents} (${paymentType})`
    )
    // Acknowledge (200) — a retry cannot heal a mismatch; record it for audit
    await recordRejectedEvent(event.id, paymentIntentId, 'amount_mismatch', payloadHash)
    return NextResponse.json({ received: true, rejected: 'amount_mismatch' })
  }

  const memo = [memberId, paymentType, 'via Stripe Checkout'].filter(Boolean).join(' ')

  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()

    // 1. Idempotency guard — duplicate delivery hits the PK and aborts
    await conn.execute(
      `INSERT INTO stripe_events (event_id, payment_intent_id, status, payload_hash)
       VALUES (?, ?, 'processed', ?)`,
      [event.id, paymentIntentId, payloadHash]
    )

    // 2. Ledger row — same shape as a Gmail-parsed Zelle/Venmo transaction
    await conn.execute(
      `INSERT INTO gmail_transactions
         (TransactionNumber, Timestamp, Sender, Amount, Memo, TransactionDate,
          PaymentMethod, MessageId, Subject, OriginalMemo)
       VALUES (?, NOW(), ?, ?, ?, CURDATE(), 'Stripe', ?, 'Stripe Checkout', ?)`,
      [paymentIntentId, payerName, amount, memo, event.id,
       `session=${session.id}` + (payerEmail ? ` email=${payerEmail}` : '')]
    )

    // 3. Payment via the standard proc (validates tx + member, fires all triggers)
    if (memberId) {
      await conn.query(
        'CALL sp_link_transaction(?, ?, ?, ?, ?)',
        [paymentIntentId, memberId, paymentType, amount, submissionId]
      )
    } else {
      // Anonymous donation — no member to validate; direct insert against the
      // ledger row (trg_payments_auto_fill fills payer/date/memo,
      // trg_payments_approve_submission still approves the submission)
      await conn.execute(
        `INSERT INTO payments
           (PaymentID, MemberID, TransactionNumber, PaymentType, Amount, SubmissionID, UpdatedAt)
         VALUES (REPLACE(UUID(), '-', ''), NULL, ?, ?, ?, ?, NOW())`,
        [paymentIntentId, paymentType, amount, submissionId]
      )
    }

    await conn.commit()
  } catch (err: any) {
    await conn.rollback()
    if (err?.code === 'ER_DUP_ENTRY') {
      // Stripe retried an event we already recorded — done
      return NextResponse.json({ received: true, duplicate: true })
    }
    console.error('[stripe/webhook] Failed to record payment:', err)
    // Non-2xx → Stripe retries with backoff; rollback left no partial state
    return NextResponse.json({ error: 'Failed to record payment' }, { status: 500 })
  } finally {
    conn.release()
  }

  return NextResponse.json({ received: true })
}

// Expected charge in cents: config price for membership types, the submissions
// row amount for donations. Returns null if no authoritative source (skip check).
async function expectedAmountCents(
  paymentType: string,
  submissionId: string | null
): Promise<number | null> {
  try {
    if (MEMBERSHIP_PRICING[paymentType]) {
      const price = await getMembershipPrice(paymentType)
      return price != null ? Math.round(price * 100) : null
    }
    if (submissionId) {
      const conn = await pool.getConnection()
      try {
        const [rows] = await conn.execute<RowDataPacket[]>(
          'SELECT Amount FROM submissions WHERE SubmissionID = ?',
          [submissionId]
        )
        const amt = Number(rows[0]?.Amount)
        return Number.isFinite(amt) && amt > 0 ? Math.round(amt * 100) : null
      } finally {
        conn.release()
      }
    }
    return null
  } catch (err) {
    console.error('[stripe/webhook] expectedAmountCents failed:', err)
    return null // fail open on the check, not the payment
  }
}

// Audit trail for events acknowledged but not processed (e.g. amount mismatch)
async function recordRejectedEvent(
  eventId: string,
  paymentIntentId: string,
  status: string,
  payloadHash: string
): Promise<void> {
  try {
    const conn = await pool.getConnection()
    try {
      await conn.execute(
        `INSERT INTO stripe_events (event_id, payment_intent_id, status, payload_hash)
         VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE status = VALUES(status)`,
        [eventId, paymentIntentId, status, payloadHash]
      )
    } finally {
      conn.release()
    }
  } catch (err) {
    console.error('[stripe/webhook] recordRejectedEvent failed:', err)
  }
}
