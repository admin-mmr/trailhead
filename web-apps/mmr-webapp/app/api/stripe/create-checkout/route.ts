import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'
import { z } from 'zod'

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!)

const PRICE_IDS: Record<string, string> = {
  individual: process.env.STRIPE_INDIVIDUAL_PRICE_ID!,
  family:     process.env.STRIPE_FAMILY_PRICE_ID!,
}

const schema = z.object({
  memberId:       z.string(),
  membershipType: z.enum(['individual', 'family']),
})

export async function POST(req: NextRequest) {
  try {
    const body   = await req.json()
    const { memberId, membershipType } = schema.parse(body)

    const session = await stripe.checkout.sessions.create({
      mode:        'payment',
      line_items: [{ price: PRICE_IDS[membershipType], quantity: 1 }],
      metadata:   { memberId, membershipType },
      success_url: `${process.env.NEXT_PUBLIC_APP_URL}/portal?payment=success`,
      cancel_url:  `${process.env.NEXT_PUBLIC_APP_URL}/join?payment=cancelled`,
    })

    return NextResponse.json({ ok: true, data: { sessionId: session.id } })
  } catch (err: any) {
    console.error('[POST /api/stripe/create-checkout]', err)
    return NextResponse.json({ ok: false, error: 'Checkout creation failed.' }, { status: 500 })
  }
}
