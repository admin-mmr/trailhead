/**
 * fulfillment-email.ts — the email a completed Stripe payment earns.
 *
 * Called by the Stripe webhook AFTER its DB transaction commits, so the member
 * row already reflects the trigger cascade (status active, expiration set).
 * Never throws: a mail failure must not turn a recorded payment into a 500,
 * which would make Stripe retry a payment we already banked.
 *
 * Which email goes out:
 *   - brand-new member (activated, no password and no linked Google/Microsoft
 *     account) → welcome email: member ID, expiration, payment receipt, and a
 *     "set my password" link, because /join never sets one
 *   - renewal / upgrade → payment confirmation with the new expiration
 *   - donation (member or anonymous) → donation receipt
 *
 * Plus, for a membership payment that covers a family, every OTHER member of
 * that family gets a notice with the shared new expiration and the covered
 * roster (lib/notifications/family.ts). Without it a spouse or child has no way
 * to know their membership was renewed — the payments trigger extends their row
 * silently.
 */

import type { RowDataPacket } from 'mysql2'
import { pool } from '@/lib/db/connection'
import { sendMemberWelcomeEmail, sendPaymentConfirmationEmail } from '@/lib/email/client'
import { notifyFamilyRenewal } from '@/lib/notifications/family'
import { MEMBERSHIP_PRICING } from '@/lib/db/config'
import { APP_URL } from '@/lib/email/_layout'

export interface FulfillmentEmailInput {
  memberId:      string | null
  paymentType:   string
  amount:        number
  referenceId:   string          // Stripe PaymentIntent id — matches the ledger row
  paymentMethod: string          // 'Stripe' | 'Stripe (TEST)'
  payerEmail:    string | null   // from Stripe customer_details
  payerName:     string | null
  livemode:      boolean
}

interface MemberEmailRow extends RowDataPacket {
  Email:           string | null
  FirstName:       string | null
  Status:          string | null
  Expiration:      Date | string | null
  Type:            string | null
  password_hash:   string | null
  google_sub:      string | null
  microsoft_sub:   string | null
}

export async function sendFulfillmentEmail(input: FulfillmentEmailInput): Promise<void> {
  try {
    const isMembership = Boolean(MEMBERSHIP_PRICING[input.paymentType])
    const member = input.memberId ? await loadMember(input.memberId) : null

    const to = member?.Email ?? input.payerEmail
    if (!to) {
      console.warn(`[fulfillment-email] No address for ${input.referenceId} — skipping`)
      return
    }

    const firstName = member?.FirstName || firstNameFrom(input.payerName) || 'Runner'
    const paidOn    = new Date().toISOString().slice(0, 10)
    const testMode  = !input.livemode
    const expiresAt = toDateString(member?.Expiration)

    // Brand-new member: activated by this payment, but no way to sign in yet.
    const needsPassword =
      !member?.password_hash && !member?.google_sub && !member?.microsoft_sub

    if (isMembership && member && member.Status === 'active' && needsPassword) {
      await sendMemberWelcomeEmail({
        to,
        firstName,
        memberId:  input.memberId!,
        expiresAt: expiresAt ?? '',
        planLabel: input.paymentType,
        payment: {
          amount:        input.amount,
          paymentMethod: input.paymentMethod,
          referenceId:   input.referenceId,
          paidOn,
        },
        setPasswordUrl: setPasswordUrl(to),
        testMode,
      })
    } else {
      await sendPaymentConfirmationEmail({
        to,
        firstName,
        amount:        input.amount,
        paymentMethod: input.paymentMethod,
        referenceId:   input.referenceId,
        description:   input.paymentType,
        paidOn,
        expiresAt:     isMembership ? expiresAt ?? undefined : undefined,
        memberId:      input.memberId ?? undefined,
        testMode,
      })
    }

    // The payer now has a receipt. Anyone else the payment covers has heard
    // nothing at all — the trigger silently extended their expiration too. Tell
    // the rest of the household, skipping the payer to avoid a near-duplicate.
    // Keyed on the PaymentIntent so a Stripe webhook retry cannot re-send.
    if (isMembership && input.memberId && expiresAt) {
      await notifyFamilyRenewal({
        payerMemberId: input.memberId,
        expiresAt,
        planLabel:     input.paymentType,
        dedupeSuffix:  input.referenceId,
        testMode,
        skipPayer:     true,
      })
    }
  } catch (err) {
    // Deliberately swallowed — see the file header.
    console.error(`[fulfillment-email] Failed for ${input.referenceId}:`, err)
  }
}

// New members have no password, so the welcome email links straight to the
// reset form with their address prefilled. No token in the link: welcome mail
// is CC'd to the admin address, and a live credential link must not be.
function setPasswordUrl(email: string): string {
  return `${APP_URL}/auth/forgot-password?email=${encodeURIComponent(email)}`
}

async function loadMember(memberId: string): Promise<MemberEmailRow | null> {
  const conn = await pool.getConnection()
  try {
    const [rows] = await conn.execute<MemberEmailRow[]>(
      `SELECT Email, FirstName, Status, Expiration, Type,
              password_hash, google_sub, microsoft_sub
         FROM members WHERE MemberID = ?`,
      [memberId]
    )
    return rows[0] ?? null
  } finally {
    conn.release()
  }
}

function toDateString(value: Date | string | null | undefined): string | null {
  if (!value) return null
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  return String(value).slice(0, 10)
}

function firstNameFrom(fullName: string | null): string | null {
  return fullName?.trim().split(/\s+/)[0] || null
}
