import { NextResponse } from 'next/server'
import { isStripeTestMode } from '@/lib/stripe'

// ── GET /api/payments/stripe/mode ───────────────────────────────────────────
// Tells the join/donate wizards whether card payments run in Stripe test mode,
// so the member-facing "no real charge" banner appears exactly when true and
// disappears automatically once sk_live_ keys are configured.
export const dynamic = 'force-dynamic'

export async function GET() {
  return NextResponse.json({ testMode: isStripeTestMode() })
}
