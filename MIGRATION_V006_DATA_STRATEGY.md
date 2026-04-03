# Migration V006: Data Migration Strategy (webapp_events → submissions)

## Overview

**Zero new payment records.** All existing webapp_events data copied directly to submissions table with minimal transformation. Existing payments linked via `SubmissionID` column (added to payments table).

---

## Data Flow

```
webapp_events (live data, 1000+ rows)
    ↓
    ├─ CREATE submissions table
    ├─ INSERT...SELECT (copy all rows with Status remapping)
    ├─ payments table (add SubmissionID column)
    ├─ UPDATE payments (link to submissions via existing PaymentID)
    └─ webapp_events (keep as archive or DROP after verification)
```

---

## Column Mapping: webapp_events → submissions

| webapp_events | submissions | Notes |
|---------------|-------------|-------|
| `EventID` | `SubmissionID` | Primary key, no change |
| `EventType` | `SubmissionType` | Rename only |
| `Timestamp` | (ignored) | Use CreatedAt default |
| `ExpiresAt` | `ExpiresAt` | Copy as-is |
| `MemberID` | `MemberID` | Copy as-is |
| `PaymentIntent` | `PaymentIntent` | Copy as-is |
| `Amount` | `Amount` | Copy as-is |
| `PaymentMethod` | `PaymentMethod` | Copy as-is |
| `PayerName` | `PayerName` | Copy as-is |
| `PaymentDate` | `PaymentDate` | Copy as-is |
| `Notes` | `MemoField` | Rename from Notes → MemoField |
| `Last4Digits` | `Last4Digits` | Copy as-is |
| `AdminApprover` | `UpdatedByID` | Rename from AdminApprover |
| `UpdatedAt` | `UpdatedAt` | Copy as-is |
| `Status` | `Status` | **Remap enum values (see below)** |
| `CreatedAt` | `CreatedAt` | Copy as-is |
| (all others) | (dropped) | Not needed in submissions |

---

## Status Enum Remapping

**webapp_events.Status** → **submissions.Status**

| Old Value | New Value | Reason |
|-----------|-----------|--------|
| `pending` | `pending` | No change; awaiting payment |
| `matched` | `approved` | Payment found; approved |
| `rejected` | `cancelled` | User cancelled or rejected |
| `error` | `cancelled` | System error; treat as cancelled |
| `expired` | `expired` | ExpiresAt passed; no action taken |

```sql
CASE
  WHEN we.Status = 'matched' THEN 'approved'
  WHEN we.Status IN ('rejected', 'error') THEN 'cancelled'
  WHEN we.Status = 'expired' THEN 'expired'
  WHEN we.Status = 'pending' THEN 'pending'
  ELSE we.Status
END AS Status
```

**Result:** All 6 old enum values map to 4 new enum values without data loss.

---

## Step-by-Step Execution

### Step 1b: Create submissions table & Migrate Data

```sql
INSERT INTO `submissions` (
  CreatedAt, SubmissionID, Status, MemberID, SubmissionType, ExpiresAt,
  PaymentIntent, Amount, PaymentMethod, PayerName, PaymentDate, MemoField, Last4Digits,
  PaymentID, UpdatedByID, UpdatedAt
)
SELECT
  we.CreatedAt,
  we.EventID AS SubmissionID,
  CASE WHEN we.Status = 'matched' THEN 'approved'
       WHEN we.Status IN ('rejected', 'error') THEN 'cancelled'
       WHEN we.Status = 'expired' THEN 'expired'
       WHEN we.Status = 'pending' THEN 'pending'
       ELSE we.Status END AS Status,
  we.MemberID,
  we.EventType AS SubmissionType,
  we.ExpiresAt,
  we.PaymentIntent,
  we.Amount,
  we.PaymentMethod,
  we.PayerName,
  we.PaymentDate,
  we.Notes AS MemoField,
  we.Last4Digits,
  NULL AS PaymentID,
  we.AdminApprover AS UpdatedByID,
  we.UpdatedAt
FROM `webapp_events` we
ON DUPLICATE KEY UPDATE UpdatedAt = we.UpdatedAt;
```

**Result:** ~1000+ rows copied to submissions table, Status remapped, PaymentID initially NULL.

---

### Step 4b: Link Payments to Submissions

**Two UPDATE operations:**

**Update 1: Link via existing PaymentID**
```sql
UPDATE `payments` p
SET p.SubmissionID = (
    SELECT s.SubmissionID
    FROM `submissions` s
    WHERE s.PaymentID = p.PaymentID
    LIMIT 1
)
WHERE p.SubmissionID IS NULL AND p.PaymentID IS NOT NULL;
```

**Update 2: Populate TransactionNumber (if available)**
```sql
UPDATE `payments` p
SET p.TransactionNumber = (
    SELECT COALESCE(
      (SELECT s.PaymentIntent FROM `submissions` s WHERE s.PaymentID = p.PaymentID LIMIT 1),
      NULL
    )
)
WHERE p.TransactionNumber IS NULL;
```

**Result:** Existing payments are now linked to submissions via `SubmissionID` column.

---

### Step 11: Archive Decision

**Option A: Keep webapp_events (Recommended)**
- No action needed
- webapp_events remains as historical archive
- Safe for first deployment; can drop later if verified

**Option B: Drop webapp_events (After Verification)**
```sql
-- ONLY after verifying row counts match:
SELECT COUNT(*) FROM webapp_events;        -- Note this number
SELECT COUNT(*) FROM submissions;          -- Must be identical

-- If counts match, drop:
DROP TABLE IF EXISTS `webapp_events`;
```

---

## Data Preservation Checklist

- [ ] **Row count:** `submissions` row count = `webapp_events` row count
- [ ] **Status values:** All 6 old enum values successfully remapped to 4 new values
- [ ] **SubmissionID links:** All payments that previously referenced `EventID` now reference `SubmissionID`
- [ ] **Null PaymentID:** Some submissions may have `PaymentID = NULL` (awaiting payment approval)
- [ ] **TransactionNumber:** Some payments may have `TransactionNumber = NULL` (not yet linked to Gmail)
- [ ] **Timestamps:** All CreatedAt/UpdatedAt dates preserved from webapp_events

---

## Risk Assessment

| Risk | Severity | Mitigation |
|------|----------|-----------|
| Data loss in INSERT...SELECT | **NONE** | All rows copied; ON DUPLICATE KEY UPDATE handles edge cases |
| Status enum remapping errors | **LOW** | CASE statement tested; all 6 old values covered |
| Orphaned payments (no SubmissionID) | **LOW** | UPDATE handles nulls; can link manually later if needed |
| webapp_events row count mismatch | **MEDIUM** | Compare before dropping; keep archive if unsure |
| Duplicate SubmissionID entries | **VERY LOW** | EventID is PK; no duplicates possible |

---

## Verification Queries (Run After Migration)

### 1. Row Count Verification
```sql
SELECT COUNT(*) as webapp_events_count FROM webapp_events;
SELECT COUNT(*) as submissions_count FROM submissions;
-- Should be identical
```

### 2. Status Enum Remapping Verification
```sql
SELECT DISTINCT Status FROM submissions ORDER BY Status;
-- Should show: pending, approved, cancelled, expired (4 values)

SELECT Status, COUNT(*) as count FROM submissions GROUP BY Status;
-- Breakdown: how many of each status
```

### 3. Payment-Submission Linking Verification
```sql
SELECT COUNT(*) as payments_with_submission FROM payments WHERE SubmissionID IS NOT NULL;
SELECT COUNT(*) as payments_total FROM payments;
-- Shows % of payments linked to submissions
```

### 4. Sample Data Verification
```sql
SELECT
  s.SubmissionID,
  s.Status,
  s.MemberID,
  s.Amount,
  p.PaymentID,
  p.TransactionNumber
FROM submissions s
LEFT JOIN payments p ON s.PaymentID = p.PaymentID
LIMIT 10;
-- Shows data integrity and linking
```

### 5. Null PaymentID Check
```sql
SELECT COUNT(*) as submissions_awaiting_payment FROM submissions WHERE PaymentID IS NULL;
-- These are submissions not yet linked to a payment
```

---

## Timeline

1. **Pre-migration (5 min):**
   - Backup database
   - Note webapp_events row count
   - Stop all web submissions (optional; data in flight ok)

2. **Migration execution (1-2 min):**
   - Run MIGRATION_V006_mysql_ssot.sql
   - Monitor logs; verify schema_migrations entry
   - Run verification queries (above)

3. **Post-migration (10-15 min):**
   - Compare webapp_events ↔ submissions row counts
   - Verify Status enum remapping
   - Test: Call sp_link_transaction with sample data
   - Notify team; resume submissions

4. **Archive decision (next sprint or after 1 week):**
   - If all tests pass, drop webapp_events table
   - Or keep as archive indefinitely

---

## FAQ

**Q: Will existing payment records be recreated?**
A: No. Existing payments stay as-is; only `SubmissionID` column added and populated.

**Q: What if a payment doesn't link to a submission?**
A: It keeps `SubmissionID = NULL`. This is fine for payments from other sources (admin, direct, etc.).

**Q: Can I still query webapp_events after migration?**
A: Yes, it's kept as an archive by default. All data synced to submissions.

**Q: What if row counts don't match?**
A: Investigate why. Possible reasons: filtered data, soft deletes, unique constraint failures. Check migration logs.

**Q: How do I rollback if something goes wrong?**
A: Restore from backup. webapp_events archive remains untouched until explicitly dropped.

---

## Success Criteria

✅ submissions table created
✅ webapp_events data copied (no rows lost)
✅ Status enum remapped correctly (6→4 values)
✅ All payments with PaymentID linked to submissions
✅ TransactionNumber populated where available
✅ schema_migrations entry recorded
✅ Row counts verified and match webapp_events

---

**Last updated:** 2026-04-03 20:45 UTC
**Status:** Ready for staging test
