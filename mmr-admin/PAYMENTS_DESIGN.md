# Payment Reconciliation — mmr-admin Design

## Overview

A 2-step asynchronous payment workflow built into mmr-admin as a new "Payments" tab.
Designed for membership dues today, extensible to event registrations and donations.

## The Two Steps

```
Step 1: SUBMISSION          Step 2: VERIFICATION + FULFILLMENT
─────────────────           ──────────────────────────────────
Member submits payment      Admin (or auto-match) links payment
via webapp → webapp_event   to gmail_transaction → approve →
(status: pending)           execute category-specific actions
```

## Data Flow

```
webapp_events (pending)  ──┐
                           ├──→  MATCH  ──→  APPROVE  ──→  FULFILL
gmail_transactions (raw) ──┘     (manual     (admin      (category-
                                  or auto)    click)      specific)

FULFILL actions by PaymentIntent:
├── Individual Membership → update member expiration + type
├── Family Membership     → update ALL family members' expiration + type
├── Family Upgrade        → change type Individual→Family for all family members
├── [future] Event Registration → mark registration as paid
└── [future] Donation     → record donation, send receipt
```

## API Endpoints (api_payments.py)

| Method | Route | Purpose |
|--------|-------|---------|
| GET | /api/payments/dashboard | Stats: pending count, unmatched count, recent activity |
| GET | /api/payments/pending-events | All webapp_events with status pending/matched |
| GET | /api/payments/unmatched-gmail | gmail_transactions where ProcessedTime IS NULL |
| POST | /api/payments/manual-match | Body: {eventId, messageId} → link + set status=matched |
| POST | /api/payments/auto-match | Run heuristic matching on all pending events |
| POST | /api/payments/approve/{eventId} | Approve → create payment record → fulfill actions |
| POST | /api/payments/reject/{eventId} | Body: {notes} → set status=rejected |
| GET | /api/payments/history | Recent payments table with filters |
| GET | /api/payments/member/{memberId} | Member summary for admin review before approval |

## Business Logic (payment_actions.py)

### compute_membership_expiration(member, config)
- If MembershipYearEnd set → fixed date mode: max(yearEnd, current expiration)
- Else → rolling mode: max(today + renewalYears, expiration + renewalYears)

### approve_payment(event, admin_email)
Orchestrates the full approval:
1. Create payment record in `payments` table
2. Dispatch to category handler based on PaymentIntent
3. Mark webapp_event as approved
4. Mark gmail_transaction as processed (if matched)
5. Log to activity_log
6. Trigger Sheets sync (async, fire-and-forget)

### Category Handlers
- `handle_membership_payment(payment, member, config)` — update expiration + type for member (and family if Family)
- `handle_family_upgrade(payment, member)` — change type only, no expiration change
- `handle_event_registration(payment)` — [future stub]
- `handle_donation(payment)` — [future stub]

### Auto-Match Heuristic
For each pending event, scan unmatched gmail rows:
1. Amount must match exactly
2. Transaction date within ±7 days of event timestamp
3. At least ONE identifier match:
   - last4 digits match transaction number suffix
   - MemberID (A\d{4}) found in memo
   - Payer name fuzzy match (contains/contained-by)

## Schema Migration

```sql
ALTER TABLE webapp_events
  MODIFY Status ENUM('pending','matched','approved','rejected','expired','error')
  NOT NULL DEFAULT 'pending';
```

## Sheets Sync Strategy

After MySQL writes, call a lightweight sync function that:
- For now: logs the intent (member updated, fields changed)
- Future: POST to a GAS web app endpoint that writes to Sheets
- Design as fire-and-forget — MySQL is source of truth, Sheets sync is best-effort

## Frontend (Payments Tab)

Three panels in the tab:
1. **Pending Events** — table of pending/matched webapp_events with member info
2. **Unmatched Gmail** — table of unprocessed gmail_transactions
3. **Actions** — match (drag or select pair), approve, reject buttons
4. **History** — collapsible recent payments log

## Extensibility Notes

The PaymentIntent field + category handler pattern means adding new payment types
(event reg, donation) only requires:
1. New PaymentIntent value
2. New handler function in payment_actions.py
3. No schema changes needed
