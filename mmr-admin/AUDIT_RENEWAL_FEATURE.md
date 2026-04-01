# Membership Renewal Audit Feature

## Overview

The membership renewal audit feature allows admins to verify that membership renewals are correctly recorded and expiration dates are properly set across the database. The audit traces transactions through multiple data sources and flags inconsistencies.

## Files Created

### Backend

**`api_audit.py`** (234 lines)
- Flask blueprint providing `/api/audit/renewal` POST endpoint
- Core audit logic with 4-path transaction tracing strategy
- Summary statistics and detailed audit results
- Family member consistency validation

### Frontend

**`AuditPanel.js`** (437 lines)
- React component for admin portal audit interface
- Date range input for transaction search window
- Target expiration date input
- Interactive results table with expandable rows
- Summary statistics grid
- CSV export functionality

### Integration

**`app.py`** (modified)
- Registered `audit_bp` blueprint

**`templates/index.html`** (modified)
- Added AuditPanel.js script import
- Added "🔍 Renewal Audit" tab to admin dashboard
- Wired panel render condition

## How It Works

### 1. Admin Workflow

1. Navigate to "🔍 Renewal Audit" tab in admin portal
2. Set transaction date range (start_date, end_date)
3. Set target expiration date (expected member expiration)
4. Click "▶ Run Audit"
5. Review results in expandable table
6. Export results as CSV if needed

### 2. Backend Processing

The audit searches for transactions matching membership fees, then traces each transaction through 4 paths (in priority order):

#### Path 1: gmail_transactions → PaymentID → payments → members
- Uses `gmail_transactions.PaymentID` to find `payments` record
- Joins to `members` via `payments.MemberID`
- Best match (direct link)

#### Path 2: gmail_transactions → TransactionNumber → members.PaymentTransaction
- Uses `gmail_transactions.TransactionNumber` to find `members` record
- Matches `members.PaymentTransaction` field
- Direct member link

#### Path 3: gmail_transactions → TransactionNumber → payments → members
- Uses `gmail_transactions.TransactionNumber` to find `payments` record
- Matches `payments.TransactionReference` field
- Joins to `members` via `payments.MemberID`

#### Path 4: gmail_transactions → MessageId → webapp_events → members
- Uses `gmail_transactions.MessageId` (MatchedMessageId in webapp_events)
- Joins to `members` via `webapp_events.MemberID`
- Payment matched through webapp

### 3. Verification Logic

For each found member:

1. **Expiration Check**: Compares member's `Expiration` date against target
   - ✓ MATCH: Expiration matches target
   - ✗ MISMATCH: Expiration differs from target (red flag)
   - ✗ NO EXPIRATION: Member has no expiration date set (red flag)

2. **Family Consistency Check** (for Family members only):
   - Finds all members in the same FamilyID
   - Verifies all have the same expiration date
   - Reports inconsistent family members

### 4. Report Format

Each transaction in the results includes:

```
{
  "transaction_id": "msg-123456",
  "amount": 50.00,
  "transaction_date": "2026-03-15",
  "member_id": "A0001",
  "member_name": "John Doe",
  "membership_type": "Individual",
  "trace_route": "gmail_transactions → PaymentID → payments → members",
  "expiration_date": "2027-03-31",
  "target_expiration": "2027-03-31",
  "match_status": "✓ MATCH",
  "family_check": {...},  // only for Family members
  "red_flags": []         // list of issues found
}
```

### 5. Summary Statistics

The audit returns:
- **Total Transactions**: Transactions matching fee amounts in date range
- **Traced Members**: Members successfully found via trace paths
- **Expirations Matched**: Members with correct target expiration
- **Expirations Mismatched**: Members with incorrect expiration (action required)
- **Not Traced**: Transactions with no matching member record

## Configuration

Membership fee amounts are retrieved from the MySQL `config` table:
- `MembershipFeeIndividual` (default: $50.00)
- `MembershipFeeFamily` (default: $80.00)

If config values are missing, defaults are used.

## Usage Examples

### Example 1: Verify March 2026 Renewals

1. Set dates: 2026-03-01 to 2026-03-31
2. Set target expiration: 2027-03-31
3. Run audit
4. Review members with mismatched expirations
5. Correct member records or re-sync as needed

### Example 2: Audit Family Member Renewals

1. Set dates for transaction period
2. Set target expiration
3. Run audit
4. Expand Family members to see consistency checks
5. Identify families with members having different expiration dates
6. Manually correct inconsistencies or adjust renewal

## Red Flags Detected

The audit flags the following issues:

- **Expiration mismatch**: Member expiration ≠ target expiration
- **No expiration set**: Member has NULL or missing expiration date
- **Family inconsistency**: Family members have different expiration dates
- **Not traced**: Transaction not found in member/payment records

## CSV Export

Click "📥 Export CSV" to download results with columns:
- Transaction ID
- Amount
- Transaction Date
- Member ID
- Member Name
- Membership Type
- Expiration Date
- Target Expiration
- Match Status
- Trace Route
- Red Flags (semicolon-separated)

## Limitations

1. Audit only checks transactions matching known membership fee amounts
2. Traces only follow specific data relationships
3. Does not modify member records (read-only)
4. Family checks assume FamilyID is set correctly in members table
5. Does not verify payment processing state (just looks at data consistency)

## Future Enhancements

Potential improvements:
- Auto-fix expiration mismatches (one-click)
- Bulk family member correction
- Historical audit logs
- Scheduled audit runs with email reports
- Match confidence scoring for uncertain traces
- Integration with payment provider (Square, PayPal) for verification
