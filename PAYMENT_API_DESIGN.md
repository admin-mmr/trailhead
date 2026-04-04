# Payment API Design — MySQL-backed, No Sheets Sync

**Created:** 2026-04-04 | **Status:** Ready for review

## Architecture Overview

Replaced old `api_payments.py` + `payment_actions.py` + `payment_handlers.py` with a single, clean endpoint file. All heavy lifting delegated to:
- DB triggers: Update members, approve submissions, sync gmail notes
- Stored procedure: `sp_link_transaction()` — single point of payment insertion

## Data Flow & Trigger Logic

### Payment Insertion Flow

```
api_manual_approve() OR _create_payment_from_autoguess()
  ↓
  CALL sp_link_transaction(tx_num, memberID, 'Membership', amount, admin_email, submissionID)
  ├─→ INSERT INTO payments (PaymentID, MemberID, TransactionNumber, Amount, SubmissionID, PaymentType, ProcessedBy)
  └─→ UPDATE gmail_transactions SET Notes=..., UpdatedAt=NOW()

BEFORE INSERT Triggers (in order):
  1. trg_payments_auto_fill
     ├─ Fetch PaymentDate, PaymentMethod, PayerName, MemoField from gmail_transactions
     └─ Auto-populate (admin doesn't re-enter)

  2. trg_payments_limit_check_insert
     ├─ Verify: SUM(payments.Amount where TransactionNumber=X) + NEW.Amount ≤ gmail_transactions.Amount
     └─ Prevents overpayment splits

  3. trg_payments_insert_validate
     ├─ Amount ≥ 0
     └─ SubmissionID exists (if not NULL) → logs to error_context if violated

AFTER INSERT Triggers (in order):
  4. trg_payments_sync_membership_only
     ├─ If PaymentType LIKE '%Membership%':
     │  ├─ UPDATE members SET Status='active', PaymentDate, PaymentTransaction, MembershipFeePaid, Expiration=DATE_ADD(PaymentDate, INTERVAL 1 YEAR)
     │  └─ If FamilyID set: update all family members (Status, Expiration, Fees, etc.)
     └─ @internal_proc=1 flag prevents members_before_update violation

  5. trg_payments_approve_submission
     ├─ If SubmissionID IS NOT NULL:
     │  └─ UPDATE submissions SET Status='approved', PaymentID, UpdatedByID
     └─ Automatically transitions pending→approved

  6. trg_payments_sync_to_gmail_on_change_after_payment_insert
     └─ GROUP_CONCAT all linked payments for this TransactionNumber → gmail_transactions.Notes
```

## Endpoint Specifications

### Dashboard
```
GET /api/payments/dashboard
Response:
{
  "pending": 5,               # submissions.status='pending'
  "matched": 42,              # payments with SubmissionID IS NOT NULL
  "unmatched_gmail": 3,       # gmail_transactions where Notes IS NULL OR UpdatedAt IS NULL
  "approved_30d": 18,         # submissions approved in last 30 days
  "rejected_30d": 2,          # submissions cancelled in last 30 days
  "errors": 1                 # error_context with NEW/ACKNOWLEDGED status in last 7 days
}
```

### List Pending Submissions
```
GET /api/payments/pending-submissions?skip=0&limit=50&search=
Response:
{
  "submissions": [
    {
      "SubmissionID": "sub_abc123",
      "MemberID": "A0001",
      "SubmissionType": "Membership Renewal",
      "Amount": 30.00,
      "CreatedAt": "2026-04-01T10:00:00",
      "Status": "pending",
      "ExpiresAt": "2026-04-15T10:00:00",
      "FirstName": "John",
      "LastName": "Doe",
      "Email": "john@example.com",
      "MemberType": "Individual"
    }
  ]
}
```

### List Unmatched Gmail
```
GET /api/payments/unmatched-gmail?skip=0&limit=50&search=
Response:
{
  "transactions": [
    {
      "TransactionNumber": "tx_12345",
      "Timestamp": "2026-04-01T15:30:00",
      "Sender": "jane.smith@gmail.com",
      "Amount": 30.00,
      "Memo": "Payment for A0002 membership",
      "TransactionDate": "2026-04-01",
      "PaymentMethod": "Zelle",
      "Notes": null,
      "UpdatedAt": null
    }
  ]
}
```

### Autoguess All
```
POST /api/payments/autoguess-all
No request body.

Response:
{
  "created": 3,
  "skipped": 2,
  "errors": [
    {
      "transactionNumber": "tx_xyz",
      "error": "Renewal period check failed"
    }
  ]
}

Logic:
  1. For each unmatched gmail_transaction:
     a. Extract memberID from memo (regex: \bA\d{4}\b)
     b. If memberID found:
        - Member exists?
        - Amount matches expected ($30 indiv, $50 family)?
        - Date within renewal period (config: renewal_start_date, renewal_end_date)?
        - Pending membership submission exists for this member?
        - If all YES: Create payment with submissionID
        - If member exists but no submission: Create payment without submissionID
     c. If no memberID in memo:
        - Try partial name match: scan all pending membership submissions
        - Check first_name + last_name in sender OR memo?
        - Amount must match expected fee
        - Date must be within renewal period
        - If match found: Create payment with that submission's ID
     d. If no match at all: Skip (return {'created': false})
```

### Manual Approval (Updated Flow per User Feedback)
```
POST /api/payments/manual-approve
{
  "transactionNumber": "tx_12345",
  "memberID": "A0001"
}

Logic:
  1. Verify gmail_transaction exists (by TransactionNumber)
  2. Verify member exists (by MemberID)
  3. Search for pending submissions WHERE MemberID = A0001 AND Status = 'pending'
  4. If pending submission found: 
     → Create payment with submissionID (triggers approve submission automatically)
  5. If no pending submission:
     → Create payment with NULL submissionID (standalone payment)
  6. CALL sp_link_transaction(tx_num, member_id, 'Membership', amount, admin_email, submissionID)

Response:
{
  "ok": true,
  "transactionNumber": "tx_12345",
  "memberID": "A0001",
  "submissionID": "sub_abc123" | null
}
```

### Submissions for Member
```
GET /api/payments/submissions-for-member/A0001
Response:
{
  "submissions": [
    {
      "SubmissionID": "sub_abc123",
      "SubmissionType": "Membership Renewal",
      "Amount": 30.00,
      "Status": "pending",
      "CreatedAt": "2026-04-01T10:00:00",
      "ExpiresAt": "2026-04-15T10:00:00"
    }
  ]
}
```

### Gmail Matching Candidates
```
GET /api/payments/gmail-matching-candidates/A0001
Response:
{
  "candidates": [
    {
      "TransactionNumber": "tx_12345",
      "Timestamp": "2026-04-01T15:30:00",
      "Sender": "john.doe@gmail.com",
      "Amount": 30.00,
      "Memo": "Membership payment",
      "TransactionDate": "2026-04-01",
      "PaymentMethod": "Zelle",
      "Notes": null,
      "UpdatedAt": null
    }
  ]
}
Filters: Unmatched gmail where Sender or Memo matches FirstName/LastName of member
```

### Search Members
```
GET /api/payments/search-members?q=john
Response:
{
  "members": [
    {
      "MemberID": "A0001",
      "FirstName": "John",
      "LastName": "Doe",
      "Email": "john@example.com",
      "Type": "Individual",
      "Status": "pending",
      "Expiration": null
    }
  ]
}
```

## Schema Validation Checklist

✅ **Trigger Chain (7 total):**
- `trg_payments_auto_fill` — Populates date, method, payer, memo from gmail_transactions
- `trg_payments_limit_check_insert` — Validates split limit (no overpayment)
- `trg_payments_insert_validate` — Validates Amount ≥ 0, SubmissionID FK
- `trg_payments_sync_membership_only` — Updates member status, expiration, family inheritance
- `trg_payments_approve_submission` — Sets submission status to 'approved'
- `trg_payments_sync_to_gmail_on_change` — Syncs Notes on UPDATE
- `trg_payments_sync_to_gmail_on_change_after_payment_insert` — Syncs Notes on INSERT

✅ **Stored Procedure:**
- `sp_link_transaction(tx, memberID, type, amount, admin, submissionID)` — Single insert point, auto-updates gmail_transactions.Notes

✅ **Config Table:**
- Required keys: `renewal_start_date` (YYYY-MM-DD), `renewal_end_date` (YYYY-MM-DD)
- Set before running autoguess

## Known Limitations & Assumptions

1. **Renewal Period:** Must be configured in `config` table. Autoguess skips if dates not set.
2. **Membership Amounts:** Hardcoded as $30 (Individual) / $50 (Family). Can be config table if needed.
3. **Family Inheritance:** Only applies if `FamilyID` is set on member. All family members get same expiration + payment info.
4. **Name Matching:** Partial match (first_name + last_name must both appear in sender/memo, case-insensitive).
5. **Single Submission Link:** Payment can link to at most 1 submission. Split payments are separate records.
6. **Admin Email:** Taken from Flask session, logged in ProcessedBy field and gmail_transactions.Notes.

## Testing Recommendations

1. **Setup:** Insert test config rows for renewal period (e.g., 2026-01-01 to 2026-12-31)
2. **Test Autoguess:**
   - Create pending membership submission for A0001 (Individual, $30)
   - Insert unmatched gmail_transaction with memo="Payment for A0001", amount=30.00
   - Call POST /api/payments/autoguess-all
   - Verify: payment created with submissionID, member status→active, submission→approved
3. **Test Manual Approval:**
   - Create unmatched gmail_transaction (amount=30.00)
   - Create pending membership submission for A0002
   - Call POST /api/payments/manual-approve with {"transactionNumber": "...", "memberID": "A0002"}
   - Verify: payment created, submission approved, member status→active
4. **Test No Submission Match:**
   - Call manual-approve with memberID that has NO pending submissions
   - Verify: payment created with NULL submissionID (standalone payment)

## Files Modified/Created

- ❌ **Removed:** `api_payments.py`, `payment_actions.py`, `payment_handlers.py`, `static/payments.js`
- ✅ **Created:** `/mmr-admin/api_payments.py` (285 lines)
- ✅ **Updated:** `CLAUDE.md` (added payment API section)
- ℹ️ **Blueprint already registered** in `app.py` line 147-148

## Next Steps

1. Configure renewal period in `config` table
2. Test via curl/Postman
3. Frontend integration: Call endpoints for dashboard, list, autoguess
4. Monitor error_context for validation failures
