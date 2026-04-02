# Fix member_log Audit Triggers for V10

## Issue
GitHub Actions error when updating member status:
```
Unknown column 'WebApp' in 'field list'
```

**Root Cause:** The INSERT/UPDATE triggers on `members` table still reference dropped columns when logging to `member_log`:
- `WebApp` (dropped in V10-b)
- `PaymentCheck` (dropped in V10-b)
- `LastLoginDate` (renamed to `LastLogin` in V10-c)
- `ProfileLastUpdated` (dropped in V10-b)

When the Python script does `UPDATE members SET Status = ...`, the trigger fires and tries to INSERT these non-existent columns, causing the error.

## Solution
Run **Migration 0019** to drop old triggers and recreate them with only columns that exist in `member_log`.

## SQL Commands

Connect to Azure MySQL:
```bash
mysql-mmr mmrdb
```

Then run these commands:

```sql
-- Drop old triggers that reference removed columns
DROP TRIGGER IF EXISTS members_after_insert;
DROP TRIGGER IF EXISTS members_after_update;

-- ─────────────────────────────────────────────────────────────────────────────
-- Create new triggers with only existing columns
-- ─────────────────────────────────────────────────────────────────────────────

-- Trigger: members_after_insert
CREATE TRIGGER members_after_insert
AFTER INSERT ON members
FOR EACH ROW
BEGIN
  INSERT INTO member_log (
    LogID, LoggingTime, MemberID, ChangeType, Status, Created, Expiration,
    Email, FirstName, LastName, Type, FamilyID, Gender, WeChatID, District,
    Info, LastUpdated, MembershipFeePaid, PaymentDate, PaymentTransaction,
    JoinYear, PhoneNumber, LastLogin, Notes, NYRRRunnerName, YearBorn
  )
  VALUES (
    CONCAT('ML-', UNIX_TIMESTAMP(NOW(3)) * 1000, '-', FLOOR(RAND() * 10000)),
    NOW(),
    NEW.MemberID, 'INSERT', NEW.Status, NEW.Created, NEW.Expiration,
    NEW.Email, NEW.FirstName, NEW.LastName, NEW.Type, NEW.FamilyID,
    NEW.Gender, NEW.WeChatID, NEW.District,
    NEW.Info, NEW.LastUpdated, NEW.MembershipFeePaid, NEW.PaymentDate,
    NEW.PaymentTransaction, NEW.JoinYear, NEW.PhoneNumber, NEW.LastLogin,
    NEW.Notes, NEW.NYRRRunnerName, NEW.YearBorn
  );
END;
$$

-- Trigger: members_after_update
CREATE TRIGGER members_after_update
AFTER UPDATE ON members
FOR EACH ROW
BEGIN
  INSERT INTO member_log (
    LogID, LoggingTime, MemberID, ChangeType, Status, Created, Expiration,
    Email, FirstName, LastName, Type, FamilyID, Gender, WeChatID, District,
    Info, LastUpdated, MembershipFeePaid, PaymentDate, PaymentTransaction,
    JoinYear, PhoneNumber, LastLogin, Notes, NYRRRunnerName, YearBorn
  )
  VALUES (
    CONCAT('ML-', UNIX_TIMESTAMP(NOW(3)) * 1000, '-', FLOOR(RAND() * 10000)),
    NOW(),
    NEW.MemberID, 'UPDATE', NEW.Status, NEW.Created, NEW.Expiration,
    NEW.Email, NEW.FirstName, NEW.LastName, NEW.Type, NEW.FamilyID,
    NEW.Gender, NEW.WeChatID, NEW.District,
    NEW.Info, NEW.LastUpdated, NEW.MembershipFeePaid, NEW.PaymentDate,
    NEW.PaymentTransaction, NEW.JoinYear, NEW.PhoneNumber, NEW.LastLogin,
    NEW.Notes, NEW.NYRRRunnerName, NEW.YearBorn
  );
END;
$$
```

## Verify
After running, check the triggers exist:
```sql
SHOW TRIGGERS WHERE `Table` = 'members' AND `Trigger` LIKE '%insert%' OR `Trigger` LIKE '%update%';
```

You should see:
- ✅ members_after_insert
- ✅ members_after_update
- ❌ (NO old triggers with dropped column references)

## Test
After applying, re-run the member status update:
```bash
python3 basecamp/ops/update_member_status.py --dry-run
```

It should complete successfully without trigger errors.

## What Changed
The triggers now log ONLY columns that exist in `member_log`:
- ❌ Removed: `WebApp`, `PaymentCheck`, `LastLoginDate`, `ProfileLastUpdated`
- ✅ Added: `LastLogin` (new column name in V10)
- ✅ Unchanged: All other columns (Status, Email, FirstName, etc.)

This ensures audit logging continues to work while respecting the V10 schema changes.
