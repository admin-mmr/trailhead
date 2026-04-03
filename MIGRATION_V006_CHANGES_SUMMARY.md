# Migration V006: Updated Implementation Summary

**File:** `db/MIGRATION_V006_mysql_ssot.sql` (514 lines)
**Status:** ✅ Updated to match `schema_plan.sql` with ALTER TABLE strategy for existing `member_log`

## Key Updates from Original to Current Version

### 1. Member Log Refactoring (ALTER instead of DROP/CREATE)
✅ **Preserves existing data and your inline comments**

```sql
-- Step 8a: Add DEFAULT CURRENT_TIMESTAMP to LoggingTime
ALTER TABLE `member_log`
  MODIFY COLUMN `LoggingTime` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Step 8b: Change Status to enum with 'lifetime' value
ALTER TABLE `member_log`
  MODIFY COLUMN `Status` enum('active','expired','inactive','pending','lifetime') ...;

-- Step 8c: Add inline COMMENT to ChangeType
ALTER TABLE `member_log`
  MODIFY COLUMN `ChangeType` varchar(20) ... COMMENT 'INSERT, UPDATE, or DELETE';

-- Step 8d: Drop deprecated Info column
ALTER TABLE `member_log` DROP COLUMN IF EXISTS `Info`;

-- Step 8e: Drop deprecated LastLogin column (kept only in members table)
ALTER TABLE `member_log` DROP COLUMN IF EXISTS `LastLogin`;

-- Step 8f: Add comment to Notes column
ALTER TABLE `member_log`
  MODIFY COLUMN `Notes` text ... COMMENT 'Captures the combined history including Admin Overrides';
```

**Benefit:** Your existing 10,000+ audit log rows stay intact; only schema changes applied.

---

### 2. Gmail Transactions Restructuring (DROP/RENAME/CREATE)

**Reason:** TransactionNumber becomes PRIMARY KEY (was MessageId), so full rebuild necessary.

```sql
-- Backup old data
RENAME TABLE `gmail_transactions` TO `gmail_transactions_backup`;

-- New structure with correct primary key and columns
CREATE TABLE `gmail_transactions` (
  `TransactionNumber` varchar(100) ... PRIMARY KEY,
  `Timestamp` datetime ... COMMENT 'From Sheets/GAS',
  `Sender` varchar(255) ...,
  `Amount` decimal(10,2) ... COMMENT 'Total original amount',
  `Memo` text ...,
  `TransactionDate` date ...,
  `PaymentMethod` varchar(100) ... COMMENT 'Zelle, Venmo, etc.',
  `MessageId` varchar(100) NOT NULL,
  `OriginalMemo` text ...,
  `Notes` text ... COMMENT 'User friendly split summary: <MemberID> <Type> <Amt>',
  `UpdatedAt` datetime ... COMMENT 'Last linked time'
) ENGINE=InnoDB ...;

-- Migrate data from backup (preserves all existing gmail transactions)
INSERT INTO `gmail_transactions` (...)
SELECT ... FROM `gmail_transactions_backup`;

DROP TABLE `gmail_transactions_backup`;
```

**New columns:**
- `Notes` — Admin-friendly split summary (auto-updated by `sp_link_transaction`)
- `UpdatedAt` — Tracks last link/update time

---

### 3. Payment Triggers (Updated from schema_plan)

#### `trg_payments_auto_fill` (BEFORE INSERT)
Reads from **NEW gmail_transactions schema** (PaymentMethod, Sender, Memo):
```sql
SELECT TransactionDate, PaymentMethod, Sender, Memo
INTO @d, @m, @p, @memo
FROM gmail_transactions WHERE TransactionNumber = NEW.TransactionNumber LIMIT 1;

SET NEW.PaymentDate = @d, NEW.PaymentMethod = @m,
    NEW.PayerName = @p, NEW.MemoField = @memo;
```

#### `trg_payments_limit_check_insert` (BEFORE INSERT)
Validates total split amount doesn't exceed gmail_transaction balance.

#### `trg_payments_limit_check_update` (BEFORE UPDATE)
Validates update amount doesn't exceed remaining balance (excludes current row).

#### `trg_payments_post_process` (AFTER INSERT)
Two behaviors:
1. **If PaymentType LIKE '%Membership%':** Updates member Status to 'active', sets Expiration = +1 year
2. **If SubmissionID IS NOT NULL:** Approves linked submission

---

### 4. Member Audit Triggers (New: AFTER INSERT/UPDATE)

```sql
-- Capture initial state when member created
CREATE TRIGGER `trg_members_after_insert`
AFTER INSERT ON `members` FOR EACH ROW
BEGIN
  INSERT INTO member_log (LogID, LoggingTime, MemberID, ChangeType, Status, ...)
  VALUES (UUID(), NOW(), NEW.MemberID, 'INSERT', NEW.Status, ...);
END;

-- Capture changes when member updated
CREATE TRIGGER `trg_members_after_update`
AFTER UPDATE ON `members` FOR EACH ROW
BEGIN
  INSERT INTO member_log (LogID, LoggingTime, MemberID, ChangeType, Status, ...)
  VALUES (UUID(), NOW(), NEW.MemberID, 'UPDATE', NEW.Status, ...);
END;
```

---

### 5. New Admin Procedures

#### `sp_admin_update_member_status(p_AdminEmail, p_MemberID, p_NewStatus, p_NewExpiration, p_NewNotes)`
Safe admin override for member status/expiration (only way to directly update Expiration column).
- Unlocks @internal_proc = 1 during update
- Records change in `admin_member_overrides` table
- Appends to member.Notes with timestamp and admin email
- Updates entire family if applicable

#### `sp_link_transaction(p_TxNum, p_MemID, p_Type, p_Amt, p_Admin, p_SubID)`
Admin-driven payment split linking.
- Creates payment record with auto-filled data from gmail_transactions
- Updates gmail_transactions.Notes with clean split summary
- Sets UpdatedAt = NOW()

---

### 6. Views

#### `v_payment_details` (Enhanced)
```sql
SELECT PaymentID, CreatedAt, MemberID, MemberFullName, FamilyID,
       PaymentType, Amount, PaymentDate, TransactionNumber,
       SubmissionType, ProcessedBy, Source
FROM payments p
JOIN members m ON p.MemberID = m.MemberID
LEFT JOIN submissions s ON p.SubmissionID = s.SubmissionID;
```

#### `v_gmail_split_audit` (New)
```sql
SELECT TransactionNumber, Total, Allocated, Balance, SplitHistory
FROM gmail_transactions gt
LEFT JOIN payments p ON gt.TransactionNumber = p.TransactionNumber
GROUP BY gt.TransactionNumber;
```

Shows unallocated balance per transaction, useful for finding leftover amounts.

---

## Component Summary

| Component | Action | Count | Note |
|-----------|--------|-------|------|
| **Tables** | CREATE | 2 (submissions, admin_member_overrides) | Direct creation |
| **Tables** | DROP/RENAME/CREATE | 1 (gmail_transactions) | Restructure needed |
| **Tables** | ALTER | 1 (member_log) | Preserves existing data |
| **Triggers** | CREATE | 9 | members_before_update, trg_payments_* (4), trg_members_after_* (2), members_insert/update_*_unix (2) |
| **Procedures** | CREATE | 2 | sp_admin_update_member_status, sp_link_transaction |
| **Views** | CREATE | 3 | v_payment_details, v_gmail_split_audit |

---

## Execution Path

1. **Disable foreign key checks**
2. Create `submissions` table
3. Create `admin_member_overrides` table
4. Alter `members` table (add Status enum 'lifetime', add Notes column)
5. Update `payments` table (add TransactionNumber column)
6. **Restructure `gmail_transactions`** (backup → create new → migrate → drop backup)
7. Create all triggers (members guard, payment auto-fill, split validation, post-process, audit logging)
8. Create procedures (admin status updates, transaction linking)
9. Create/recreate views
10. Record migration in schema_migrations
11. **Re-enable foreign key checks**

---

## Data Preservation Strategy

### member_log (10,000+ rows)
✅ **Preserved via ALTER TABLE**
- LoggingTime default applied
- Status enum expanded (backward compatible)
- Info & LastLogin columns removed (deprecated)
- All existing audit records stay

### gmail_transactions (1,000+ rows)
⚠️ **Requires data migration during DROP/RENAME/CREATE**
- Data copied from backup to new table
- All transaction data preserved
- Primary key changes from MessageId → TransactionNumber
- MessageId kept as secondary column

### payments, members tables
✅ **No data loss, only schema additions**
- Added columns have defaults or are optional
- Existing payments/members unaffected

---

## Inline Comments Preserved

All your inline COMMENT directives from `schema_plan.sql` are preserved:
- `ChangeType` — 'INSERT, UPDATE, or DELETE'
- `Status` (member_log) — enum with lifetim/active/expired/inactive/pending
- `Notes` — 'Captures the combined history including Admin Overrides'
- `gmail_transactions.PaymentMethod` — 'Zelle, Venmo, etc.'
- `gmail_transactions.Notes` — 'User friendly split summary: <MemberID> <Type> <Amt>'

---

## Risk Assessment

| Risk | Severity | Mitigation |
|------|----------|-----------|
| gmail_transactions data loss | **HIGH** | Data copied to backup, then migrated; verify row counts match |
| member_log data loss | **LOW** | ALTER TABLE preserves all rows; no drop/create |
| Foreign key constraint failures | **MEDIUM** | SET FOREIGN_KEY_CHECKS = 0 at start, = 1 at end |
| Trigger conflicts (old vs new) | **MEDIUM** | All old triggers DROP IF EXISTS before CREATE |
| Application downtime | **MEDIUM** | Run during maintenance window; notify users |

---

## Testing Checklist

- [ ] Run on staging first; verify row counts before/after
- [ ] Query member_log; confirm Status enum works and old rows preserved
- [ ] Query gmail_transactions; confirm all transactions migrated
- [ ] Test trg_payments_auto_fill: create payment → check fields auto-filled
- [ ] Test trg_payments_post_process: create Membership payment → check member Status/Expiration auto-updated
- [ ] Test sp_admin_update_member_status: call procedure → verify admin_member_overrides entry
- [ ] Test sp_link_transaction: call procedure → verify Notes updated in gmail_transactions
- [ ] Query v_gmail_split_audit: verify Allocated/Balance calculations correct

---

## Files Changed

- ✅ `db/MIGRATION_V006_mysql_ssot.sql` — 514 lines (updated)
- ✅ `.github/workflows/run-db-migrations.yml` — Already in place (no changes needed)
- ✅ `MIGRATION_V006_GUIDE.md` — Supplementary (review for details)

---

**Last updated:** 2026-04-03 20:30 UTC
**Status:** Ready for staging test
