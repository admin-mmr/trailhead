import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'
import { getDb } from '@/lib/db/connection'
import { activateMember } from '@/lib/db/members'
import { getMemberById } from '@/lib/db/members'
import { sendMemberWelcomeEmail } from '@/lib/email/client'
import type { MembershipType } from '@/types'

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!)

export async function POST(req: NextRequest) {
  const payload   = await req.text()
  const sig       = req.headers.get('stripe-signature')!
  const secret    = process.env.STRIPE_WEBHOOK_SECRET!

  let event: Stripe.Event
  try {
    event = stripe.webhooks.constructEvent(payload, sig, secret)
  } catch (err: any) {
    console.error('[Stripe webhook] Signature error:', err.message)
    return new NextResponse(`Webhook Error: ${err.message}`, { status: 400 })
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object as Stripe.Checkout.Session
    const memberId      = session.metadata?.memberId as string
    const membershipType = session.metadata?.membershipType as MembershipType

    if (!memberId || !membershipType) {
      console.error('[Stripe webhook] Missing metadata:', session.metadata)
      return new NextResponse('Missing metadata', { status: 400 })
    }

    try {
      const db = getDb()

      // 1. Activate member — THIS is the ONLY place status='active' is set
      await activateMember(memberId, membershipType)

      // 2. Record payment
      await db.execute(
        `INSERT INTO payment_history
           (member_id, amount, currency, stripe_session_id, membership_type, status, paid_at)
         VALUES (?, ?, ?, ?, ?, 'paid', NOW())`,
        [
          memberId,
          (session.amount_total ?? 0) / 100,
          session.currency?.toUpperCase() ?? 'USD',
          session.id,
          membershipType,
        ]
      )

      // 3. Activity log
      await db.execute(
        `INSERT INTO activity_log (member_id, action, detail)
         VALUES (?, 'payment_confirmed', ?)`,
        [memberId, `Stripe session ${session.id}`]
      )

      // 4. Welcome email
      const member = await getMemberById(memberId)
      if (member) {
        await sendMemberWelcomeEmail({
          to:        member.email,
          memberId:  member.memberId,
          name:      member.englishName ?? member.chineseName ?? member.email,
          expiresAt: member.expiresAt!,
        })
      }

      console.log(`[Stripe webhook] Activated member ${memberId}`)
    } catch (err) {
      console.error('[Stripe webhook] Error processing payment:', err)
      return new NextResponse('Internal error', { status: 500 })
    }
  }

  return new NextResponse('ok', { status: 200 })
}

// Stripe needs raw body — disable body parsing
export const config = { api: { bodyParser: false } }
