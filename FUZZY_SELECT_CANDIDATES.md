# Fuzzy Select: Candidate Transaction Ranking

## Overview

`fuzzy_select_transaction_to_submission()` returns a **ranked list of Gmail transactions** for the admin to choose from in the quick-approve UI. Transactions are scored by fuzzy matching rules and sorted by confidence.

**File:** `/mmr-admin/api_payments.py`

**Endpoint:** `GET /api/payments/gmail-candidates/<submission_id>`

---

## What It Does

Given a pending submission, finds all unmatched Gmail transactions with matching amount and ranks them by fuzzy matching priority.

**Use Case:** Admin clicks a submission (e.g., "A0123, $30") → See transactions sorted by how likely they match → Click to approve.

---

## Response Format

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
    "Email": "john@smith.com",
    "WeChatID": "johnsmith",
    "Type": "Individual",
    "Expiration": "2026-03-31"
  },
  "candidates": [
    {
      "MessageId": "msg_1234",
      "TransactionNumber": "gmx_12345",
      "Sender": "john@example.com",
      "Amount": 30.00,
      "Memo": "A0123 renewal payment",
      "TransactionDate": "2026-03-15",
      "Notes": null,
      "priority": 1,
      "matched": true
    },
    {
      "MessageId": "msg_1235",
      "TransactionNumber": "gmx_12346",
      "Sender": "jane@example.com",
      "Amount": 30.00,
      "Memo": "membership renewal",
      "TransactionDate": "2026-03-14",
      "Notes": null,
      "priority": 0,
      "matched": false
    }
  ],
  "count": 2,
  "total_candidates": 87
}
```

---

## Ranking Algorithm

Candidates are **sorted by priority (highest first)**, then by matched status, then by date (newest first).

```
Sort key: (priority DESC, matched DESC, TransactionDate DESC)
```

### Priority Levels

| Priority | Rule | Example | UI Label |
|----------|------|---------|----------|
| **1** | MemberID substring in transaction text | Memo: "A0123 renewal" | 🥇 HIGHEST |
| **2** | Last 4 digits of TransactionNumber match | TxNo: "gmx_1234_0123" → A0123 | 🥈 HIGH |
| **3** | All sender words in member text | Sender: "john smith" + Member: "John Smith" | 🥉 MEDIUM |
| **4** | Any member word in transaction text | Member: "john" + Memo: "from john" | LOW |
| **0** | No match | Memo: "random" | NO MATCH |

---

## Example: Admin Quick-Approve Flow

**Scenario:** Admin clicks submission "A0123, $30 individual"

**GET `/api/payments/gmail-candidates/EV-1234567890`**

**Response (candidates ranked):**

```
1. TX0123 — 🥇 HIGHEST: MemberID in transaction
   Sender: john@example.com
   Memo: A0123 renewal payment
   Date: 2026-03-15
   → MOST LIKELY, admin can click to approve immediately

2. TX0124 — 🥈 HIGH: TransactionNumber digits match
   Sender: jane@example.com
   Memo: membership
   Date: 2026-03-14
   → Also looks good, admin can review

3. TX0125 — 🥉 MEDIUM: Sender name matches
   Sender: john smith
   Memo: payment
   Date: 2026-03-12
   → Possible match, lower confidence

4. TX0126 — LOW: Any word matches
   Sender: robert@example.com
   Memo: from john
   Date: 2026-03-10
   → Low confidence, admin probably skips

5. TX0127 — NO MATCH
   Sender: charlie@example.com
   Memo: random payment
   Date: 2026-03-08
   → No matching signal, admin ignores
```

**Admin workflow:**
1. See highest-priority transaction first (likely correct)
2. Click to approve → `POST /api/payments/manual-approve` with TransactionNumber
3. If none match, scroll down to see lower-confidence candidates

---

## Integration with UI

The frontend `PaymentsPanel.js` receives candidates sorted by priority:

```javascript
// User clicks submission
const response = await fetch(`/api/payments/gmail-candidates/${submissionId}`)
const { candidates, member } = await response.json()

// Candidates already sorted by priority
// Display top 3-5 in quick-approve popover
// Show all on expand
```

Admin sees most likely matches first → faster reconciliation.

---

## Performance

- **Query:** Filters by `Amount` (SQL), limits to 100 rows
- **Scoring:** O(n) where n = candidates (~20-50 typical)
- **Sorting:** O(n log n) for 100 candidates
- **Total:** ~100-200ms for typical submission

---

## Key Features

✅ **Confidence-based ranking** — Highest priority first
✅ **Matched flag** — Shows which transactions have matching signals
✅ **Full context** — Returns member info for admin reference
✅ **Efficient** — SQL filters by amount before Python scoring
✅ **No auto-approval** — Admin explicitly clicks to approve (not like autoguess)

---

## Function Signature

```python
def fuzzy_select_transaction_to_submission(submission_id: str, max_candidates: int = 20) -> dict:
    """
    Find candidate Gmail transactions for a submission, ranked by fuzzy match score.

    Returns top N candidates (default 20) sorted by priority.
    """
```

---

**Last Updated:** April 4, 2026
**Status:** ✅ IMPLEMENTED — Ready to use in quick-approve UI
