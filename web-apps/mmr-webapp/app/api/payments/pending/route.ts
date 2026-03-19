import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth/session'
import { pool } from '@/lib/db/connection'

// ── GET /api/payments/pending ─────────────────────────────────────────────────
// Returns open (Pending) payment events for the currently logged-in member.
// Used by DashboardClient on every portal load to derive "pending" state (PRDv4).
export async function GET(req: NextRequest) {
  try {
    const session = await getSession(req)
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const conn = await pool.getConnection()
    let events: unknown[]
    try {
      const [rows] = await conn.execute(
        `SELECT event_id, payment_intent, amount, payment_method, created_at, proof_url
         FROM payment_events
         WHERE email = ? AND status = 'Pending'
         ORDER BY created_at DESC
         LIMIT 10`,
        [session.email]
      )
      events = rows as unknown[]
    } finally {
      conn.release()
    }

    return NextResponse.json({ events })
  } catch (err) {
    console.error('[payments/pending] Error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
