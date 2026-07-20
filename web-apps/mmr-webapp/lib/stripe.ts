// ============================================================
// lib/stripe.ts — Lazy server-side Stripe client
//
// Test mode: use sk_test_… keys (set in .env.local). The same code
// works in live mode by swapping the keys — no code changes needed.
// ============================================================

import Stripe from 'stripe'

let client: Stripe | null = null

export function getStripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY
  if (!key) throw new Error('STRIPE_SECRET_KEY is not set')
  if (!client) client = new Stripe(key)
  return client
}

/** True unless a live key (sk_live_…) is configured. Drives member-facing
 *  test-mode banners — defaults to test when unset so we never hide the
 *  banner by accident. Fulfillment decisions use event.livemode instead. */
export function isStripeTestMode(): boolean {
  return !(process.env.STRIPE_SECRET_KEY ?? '').startsWith('sk_live_')
}
