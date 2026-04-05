# Fuzzy Matching — Quick Start

## System Overview

**Two-tier reconciliation:**
1. **Autoguess (Strict)** — Firm rules: memberID explicit in memo, amount & date & renewal period all validated
2. **Fuzzy Matching (Helper)** — 4-rule scoring for candidates (available for manual review/debugging)

## Usage

### 1. Run Autoguess (Strict Auto-Match)

Automatically links transactions where memberID is **explicitly in memo** AND all conditions pass.

```bash
curl -X POST http://localhost:5000/api/payments/autoguess-all \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json"
```

**Strict Criteria (ALL must pass):**
- ✅ MemberID found in memo (regex: `\bA\d{4}\b`)
- ✅ Amount matches membership type ($30 individual, $50 family)
- ✅ Transaction date within renewal window (from config)
- ✅ Pending membership submission exists

**Response:**
```json
{
  "ok": true,
  "message": "Autoguess complete: 15 payments created, 310 skipped",
  "details": {
    "created": 15,
    "skipped": 310,
    "errors": 0
  }
}
```

Server logs show clear reasons:
```
[AUTOGUESS] Created payment for A0123 (strict match: memo=A0123, amount=30.00, renewal OK)
[AUTOGUESS] Skipped: No memberID found in memo
[AUTOGUESS] Skipped: Amount mismatch: 31.00 vs 30.00 for Individual
[AUTOGUESS] Skipped: Transaction date 2026-05-15 outside renewal period
```

### 2. Use Fuzzy Matching for Manual Testing (Optional)

For transactions that didn't autoguess, use fuzzy scoring to find candidate members:

```bash
curl http://localhost:5000/api/payments/test-fuzzy-match/EV-1234567890 \
  -H "Authorization: Bearer <token>"
```

**Response:**
```json
{
  "submission": {
    "SubmissionID": "EV-1234567890",
    "MemberID": "A0123",
    "Amount": 30.00
  },
  "member": {
    "MemberID": "A0123",
    "FirstName": "John",
    "LastName": "Smith",
    "Email": "john@example.com",
    "WeChatID": "johnsmith",
    "NYRRRunnerName": "john_runner"
  },
  "candidates": [
    {
      "gmail": {
        "TransactionNumber": "gmx_12345",
        "Sender": "john@gmail.com",
        "Amount": 30.00,
        "Memo": "A0123 renewal"
      },
      "matched": true,
      "priority": 1,
      "member_text": "john smith johnsmith john john_runner",
      "tx_text": "john@gmail.com a0123 renewal"
    },
    {
      "gmail": {
        "TransactionNumber": "gmx_12346",
        "Sender": "jane@gmail.com",
        "Amount": 30.00,
        "Memo": "membership"
      },
      "matched": false,
      "priority": 0,
      "member_text": "john smith johnsmith john john_runner",
      "tx_text": "jane@gmail.com membership"
    }
  ],
  "count": 2
}
```

### 3. Manual Approval (Admin Selects Member)

For transactions that didn't autoguess, admin can manually pick the member:

```bash
curl -X POST http://localhost:5000/api/payments/manual-approve \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "transactionNumber": "gmx_12345",
    "memberID": "A0123"
  }'
```

## Fuzzy Matching Rules (Optional, for Manual Review)

Available as a helper for transactions that didn't autoguess. 4 rules applied in priority order:

| Priority | Rule | Example |
|----------|------|---------|
| 1 | MemberID in transaction text | Memo: "A0123 renewal" |
| 2 | Last 4 digits of TxNo match MemberID | TxNo: "gmx_1234_0123" → A0123 |
| 3 | All sender words in member text | Sender: "john smith" + Member: "John Smith" |
| 4 | Any member word in transaction | Member: "John" + Sender/Memo: "john@..." |
| 0 | No match | No rules matched |

## Troubleshooting

**Problem:** Transaction has memberID in memo but autoguess still rejected it

**Possible reasons:**
- Amount mismatch: TX $30 but member type is Family (expects $50)
- Outside renewal period: TX date is 2026-05-15 but renewal window is 2025-10-01 to 2026-04-30
- No pending submission: Member has no active pending membership submission
- Date format issue: Check config table renewal_start_date/renewal_end_date are set

**Solution:** Use `/api/payments/test-fuzzy-match/<submissionID>` to score candidates and manually approve if needed.

## Performance

- **300 unmatched transactions** ~ 1-2 seconds
- Uses SQL to filter by amount first, Python for fuzzy rules
- No network overhead (all local)

## For Developers

See `PAYMENTS_FUZZY_MATCH.md` for:
- Full algorithm explanation
- Performance analysis
- Code examples
- Testing checklist
- Future enhancements
