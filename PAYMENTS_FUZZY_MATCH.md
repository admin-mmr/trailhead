# Fuzzy Matching Implementation — Submission Reconciliation

## Overview

Implemented **4-rule hybrid fuzzy matching** as a helper library for intelligent transaction-to-submission linking. The strict autoguess logic (`_autoguess_single_transaction`) uses firm criteria (explicit memberID + validation checks). Fuzzy matching is available for manual testing and future use cases.

**File:** `/mmr-admin/api_payments.py` (added 200+ lines)

**Two-Tier System:**
- **Autoguess (Strict):** Explicit memberID in memo + 5 validation checks → High confidence
- **Fuzzy Matching (Optional):** 4-rule scoring for candidates → Available for manual review/debugging

---

## Algorithm: 4 Priority Rules

When a Gmail transaction needs to match a pending submission:

```
member_text = "FirstName LastName WeChatID email_local NYRRRunnerName" (lowercase, space-separated)
tx_text = "Sender Memo Notes" (lowercase, space-separated)

Match Rules (priority order):
1. MemberID is substring of transaction_text
2. Last 4 digits of TransactionNumber match MemberID (without A prefix)
3. Every word in Sender is substring of member_text
4. Any word in member_text is substring of transaction_text
```

**Return:** `(matched: bool, priority: int)` where priority 1 is strongest, 0 = no match.

---

## Helper Functions

### `build_member_text(member: dict) -> str`
Constructs searchable text from member record.
- Input: `{FirstName, LastName, WeChatID, Email, NYRRRunnerName}`
- Output: `"john smith jw jsmith_runner"` (lowercase, space-separated, empty parts removed)

### `build_transaction_text(gmail: dict) -> str`
Constructs searchable text from Gmail transaction.
- Input: `{Sender, Memo, Notes}`
- Output: `"john@gmail.com a0123 renewal payment linked to a0123"` (lowercase, space-separated)

### `fuzzy_match_transaction_to_member(gmail, member) -> (bool, int)`
Applies all 4 rules in priority order. Returns first match (highest priority).

Example:
```python
gmail = {Sender: "john@gmail.com", Memo: "A0123 renewal", ...}
member = {FirstName: "John", LastName: "Smith", MemberID: "A0123", ...}

Rule 1: "a0123" in "john@gmail.com a0123 renewal" → TRUE, priority=1
Return: (True, 1)
```

### `find_best_matching_submission(gmail, amount) -> dict | None`
Finds the best pending membership submission for a transaction.

Algorithm:
1. Query all pending submissions with matching amount
2. For each submission's member, call `fuzzy_match_transaction_to_member()`
3. Return submission with highest priority match
4. Return None if no matches found

---

## Integration Points

### 1. Autoguess (`_autoguess_single_transaction`) — STRICT MODE

**Design:** Firm matching only — memberID must be explicit in memo, all conditions must pass.

**Algorithm (6 checks):**
1. Extract memberID from memo regex `\bA\d{4}\b` → SKIP if not found
2. Verify member exists in database
3. Check amount matches membership type ($30 individual, $50 family)
4. Check transaction date within renewal period (from config table)
5. Check pending membership submission exists for memberID
6. Create payment via `sp_link_transaction`

**Returns:** `{'created': bool, 'reason': str}`

Example:
```
TX: Memo="A0123 renewal", Amount=$30, Date=2026-04-01, Sender="john@..."
Member A0123: Type=Individual
Renewal period: 2025-10-01 to 2026-04-30
Pending submission: ✓ Found

→ ALL CHECKS PASS → Payment created ✓
```

**Rejects:**
```
Memo="renewal payment" (no memberID) → SKIP
Amount=$31 (mismatch, type=Individual expects $30) → SKIP
Date=2026-05-15 (outside renewal window) → SKIP
No pending submission for member → SKIP
```

### 2. New Debug Endpoint: `/api/payments/test-fuzzy-match/<submission_id>`

**Purpose:** Test fuzzy matching on a specific submission

**Returns:**
```json
{
  "submission": {SubmissionID, MemberID, Amount},
  "member": {MemberID, FirstName, LastName, Email, WeChatID, NYRRRunnerName},
  "candidates": [
    {
      "gmail": {TransactionNumber, Sender, Amount, Memo, ...},
      "matched": true,
      "priority": 3,
      "member_text": "john smith jw jsmith_runner",
      "tx_text": "john@gmail.com a0123 renewal"
    },
    ...
  ],
  "count": 5
}
```

---

## Performance Characteristics

| Operation | Complexity | Notes |
|-----------|-----------|-------|
| `build_member_text()` | O(1) | Constant fields (6 total) |
| `build_transaction_text()` | O(1) | Constant fields (3 total) |
| `fuzzy_match_transaction_to_member()` | O(n) | n = words in sender/member_text, ~5-10 words typical |
| `find_best_matching_submission()` | O(m * n) | m = pending submissions (~20-50), n = words (~5-10) |
| **Autoguess for 300 unmatched txns** | O(300 * m * n) | ~1-2 sec on typical dataset |

**Optimization:** Filters by amount first (SQL LIMIT 50) before fuzzy rules applied in Python.

---

## Testing Checklist

```
- [ ] Manually test fuzzy matching via /api/payments/test-fuzzy-match/<submissionID>
- [ ] Verify Rule 1 (MemberID substring match)
  - [ ] Memo: "A0123 renewal payment" → matches member A0123
- [ ] Verify Rule 2 (TransactionNumber last 4 digits)
  - [ ] TxNo: "gmx_1234567890" → matches member A0890
- [ ] Verify Rule 3 (All sender words in member_text)
  - [ ] Sender: "john smith" + member: "John Smith jw..." → match
- [ ] Verify Rule 4 (Any member word in txn_text)
  - [ ] Member: "john" + Sender: "john@..." → match
- [ ] Run autoguess POST /api/payments/autoguess-all
  - [ ] Check server logs for "priority N" in reason string
  - [ ] Verify gmail_transactions Notes updated with member_id
- [ ] Verify renewal period logic still respected (Rule 1-2 skip, Rule 3-4 check)
```

---

## Example Scenarios

### Scenario 1: Explicit MemberID in Memo (Rule 1)
```
Submission: A0123, $30 membership
Gmail TX: Sender="john@gmail.com", Memo="A0123 renewal payment"

Rule 1: "a0123" found in tx_text → matched=True, priority=1
Result: LINKED
```

### Scenario 2: Sender Name Matches All Member Words (Rule 3)
```
Submission: A0456, $50 family
Member: "Jane Smith" (FirstName LastName)
Gmail TX: Sender="jane smith partner", Memo="family membership"

Rule 1: "a0456" not in tx_text
Rule 2: "0456" not in TransactionNumber
Rule 3: ["jane", "smith"] ⊆ member_text → matched=True, priority=3
Result: LINKED
```

### Scenario 3: Partial Word Match (Rule 4)
```
Submission: A0789, $30
Member: "Bob Johnson" (FirstName LastName)
Gmail TX: Sender="robert@example.com", Memo="payment"

Rule 1-3: No match
Rule 4: "bob" in "robert@example.com" → True, priority=4
Result: LINKED (low confidence)
```

### Scenario 4: No Match
```
Submission: A0001, $30
Member: "Alice Wong"
Gmail TX: Sender="charlie@example.com", Amount=$30, Memo="random payment"

Rule 1-4: All False
Result: SKIPPED (no match)
```

---

## Key Design Decisions

1. **Hybrid Approach (SQL + Python)**
   - SQL filters by amount + basic LIKE (efficient)
   - Python applies fuzzy rules (readable, testable, easy to tune)

2. **Priority Scoring** (1 > 2 > 3 > 4)
   - Rule 1: Explicit MemberID → highest confidence
   - Rule 2: TransactionNumber pattern → high confidence
   - Rule 3: Full sender name match → medium confidence
   - Rule 4: Any word match → low confidence (could be false positives)

3. **Member Text Construction**
   - Includes multiple identifiers (name, WeChat, email local, NYRR name)
   - Increases chances of matching different sender formats
   - Case-insensitive, word-based (not substring)

4. **No Renewal Period Check for Rules 1-2**
   - These rules have high confidence
   - Admin can review later if needed
   - Reduces false negatives

5. **Explicit Check for Rules 3-4**
   - Lower confidence matches
   - Enforce renewal period to avoid stale matches

---

## Future Enhancements

- **Soundex/Levenshtein Distance:** For name variations (John vs Jon)
- **Amount Tolerance:** ±$1-2 for rounding/fee variations
- **Weighted Scoring:** Instead of binary priority, use 0.0-1.0 confidence scores
- **Machine Learning:** Train on historical matches to auto-tune rules
- **Admin Feedback Loop:** Track approved vs rejected autoguess → retrain

---

**Last Updated:** April 4, 2026
**Status:** ✅ IMPLEMENTED — Ready for testing
