# Migration V006: MySQL as Source of Truth (SSOT)

## Overview

Migration V006 establishes MySQL as the single source of truth (SSOT) for all tables except `gmail_transactions`. For `gmail_transactions`, the `UpdatedAt` and `Notes` columns are maintained in MySQL and synced back to Google Sheets on each update.

## Key Changes

### 1. **New `submissions` Table**
Replaces the previous `webapp_events` table with a clearer workflow:
- `Status` enum: `pending` → `approved` (on payment match) or `expired` (past ExpiresAt) or `cancelled` (user action)
- Columns: SubmissionID, SubmissionType, MemberID, Amount, PaymentIntent, ExpiresAt, PaymentDate, etc.
- Foreign key to `members` (on delete cascade)

### 2. **New `admin_member_overrides` Audit Table**
Tracks all manual admin changes to member records:
- Records ActionType: STATUS_CHANGE, EXPIRATION_OVERRIDE, LIFETIME_SET, INACTIVE_SET
- Stores old/new values and admin notes
- Links to target member (cascade delete)

### 3. **Enhanced `members` Table**
- Added `Status` enum value: `'lifetime'` (in addition to active/expired/inactive/pending)
- Added `Notes` column for admin override history
- Removed deprecated columns: `Info`, `LastUpdated`

### 4. **Updated `gmail_transactions` Table**
- Added `UpdatedAt` (datetime, auto-updated)
- Added `Notes` (text, for admin annotations)
- Both columns sync back to Google Sheets from MySQL

### 5. **Updated `payments` Table**
- Added `TransactionNumber` column (links to gmail_transactions)
- Triggers auto-fill payment date/method/payer from gmail_transactions

### 6. **Database Triggers**

#### `members_before_update`
Prevents direct updates to `members.Expiration` column unless `@internal_proc = 1` session variable is set. This enforces that expiration changes only happen via:
- Payment trigger (automatic on payment creation)
- Admin procedure (sp_admin_update_member_status)

#### `trg_payments_auto_fill`
When a payment is inserted with a TransactionNumber, automatically populates:
- PaymentDate
- PaymentMethod
- PayerName
- MemoField

from the corresponding `gmail_transactions` record.

#### `trg_payments_validate_amount`
Validates that payment amounts don't exceed the available balance from the source gmail_transaction, preventing over-allocation of split payments.

#### `trg_payments_sync_member`
When a payment is created:
1. Updates the payer and all family members to `Status = 'active'`
2. Sets `Expiration = DATE_ADD(PaymentDate, INTERVAL 1 YEAR)`
3. Records PaymentDate, TransactionNumber, MembershipFeePaid
4. If the payment links to a submission, marks it as `approved`

#### `trg_members_after_update`
Audit trigger: logs all member updates to `member_log` table

### 7. **Admin Procedure: sp_admin_update_member_status**

Allows admins to manually change member status/expiration with full audit trail:

```sql
CALL sp_admin_update_member_status(
  'admin@mmrunners.org',  -- AdminEmail
  'M-001',                 -- MemberID
  'lifetime',              -- NewStatus (can be NULL)
  NULL,                    -- NewExpiration (can be NULL)
  'Lifetime award for 10 years of service'  -- AdminNotes
);
```

**Safety features:**
- Unlocks the Expiration update guard via @internal_proc = 1
- Updates the member and all family members (if applicable)
- Records the change in `admin_member_overrides` table with old/new values
- Appends to member.Notes with timestamp and admin email

### 8. **Views**

#### `v_payment_details`
Joins payments with members for quick lookup:
```sql
SELECT PaymentID, MemberID, MemberFullName, Amount, PaymentDate, TransactionNumber
FROM v_payment_details
WHERE MemberID = 'M-001';
```

#### `v_payment_splits`
Shows allocation status for each gmail_transaction:
```sql
SELECT TransactionNumber, OriginalTotal, TotalAllocated, RemainingBalance
FROM v_payment_splits
WHERE RemainingBalance > 0;  -- Find unallocated transactions
```

## Migration Execution

### Automatic (via GitHub Actions)

1. **Trigger:** Push any file matching `db/MIGRATION_V*.sql` to `main` branch
2. **Workflow:** `.github/workflows/run-db-migrations.yml` executes
3. **Steps:**
   - Lists all migration files
   - Runs each migration in version order via MySQL CLI
   - Verifies entries in `schema_migrations` table
   - Reports success/failure

### Manual (Local Dev)

```bash
# Load environment from Keychain
source load-env.sh

# Run migration
mysql-mmr < db/MIGRATION_V006_mysql_ssot.sql

# Verify
mysql-mmr -e "SELECT version, description, executed_at FROM schema_migrations WHERE version = '006';"
```

## GitHub Action Configuration

### Required Secrets

Add these to your GitHub repository Settings → Secrets and Variables → Actions:

| Secret | Value | Example |
|--------|-------|---------|
| `MYSQL_HOST` | Azure MySQL server hostname | `mmr-mysql-v4.mysql.database.azure.com` |
| `MYSQL_USER` | Database user (read/write permissions) | `mmradmin` |
| `MYSQL_PASSWORD` | Database password | (from Azure portal) |
| `MYSQL_DATABASE` | Database name | `mmrdb` |

### Workflow Behavior

**On File Push:**
```
main branch
  └─ db/MIGRATION_V006_mysql_ssot.sql modified
     └─ run-db-migrations.yml triggers
        ├─ Setup MySQL CLI
        ├─ List pending migrations
        ├─ Connect to Azure MySQL
        ├─ Run all MIGRATION_V*.sql files in order
        ├─ Verify schema_migrations table
        └─ Report success/failure
```

**Manual Trigger:**
```
Actions tab → "Run Database Migrations" → "Run workflow"
  ├─ Optional: migration_version input (reserved for future use)
  └─ Executes same steps as above
```

## Data Validation

### After Migration Completes

1. **Check schema_migrations table:**
   ```sql
   SELECT * FROM schema_migrations ORDER BY executed_at DESC LIMIT 5;
   ```

2. **Verify new tables exist:**
   ```sql
   SHOW TABLES LIKE 'submissions';
   SHOW TABLES LIKE 'admin_member_overrides';
   SHOW TABLES LIKE 'member_log';
   ```

3. **Verify triggers:**
   ```sql
   SHOW TRIGGERS WHERE `Table` IN ('members', 'payments', 'submissions');
   ```

4. **Verify views:**
   ```sql
   SHOW FULL TABLES WHERE TABLE_TYPE = 'VIEW';
   ```

5. **Verify procedure:**
   ```sql
   SHOW PROCEDURE STATUS WHERE Name = 'sp_admin_update_member_status';
   ```

## Rollback (if needed)

Migration V006 includes `SET FOREIGN_KEY_CHECKS = 0` at start and `SET FOREIGN_KEY_CHECKS = 1` at end for safety, but **does not include a rollback script**. If full rollback is needed:

1. **Stop all application processes**
2. **Restore database from backup taken before migration**
3. **Re-run previous migrations if needed**

**Note:** Contact DevOps for backup restoration.

## Testing Checklist

After successful migration, test these workflows:

- [ ] **New submission workflow:** Create submission via webapp → Check `submissions` table
- [ ] **Payment trigger:** Create payment record → Check member Status/Expiration auto-updated
- [ ] **Admin override:** Call sp_admin_update_member_status → Verify `admin_member_overrides` audit entry
- [ ] **Payment split validation:** Try to over-allocate payment → Should fail with SQLSTATE '45000'
- [ ] **Gmail data sync:** Insert payment with TransactionNumber → Check PaymentDate/Method auto-filled from gmail_transactions
- [ ] **Member audit logging:** Update member → Check new entry in `member_log`
- [ ] **Views query:** Run select from `v_payment_details` and `v_payment_splits` → Should return results

## Impact Summary

| Component | Change | Impact |
|-----------|--------|--------|
| **Schema** | +2 tables, +2 columns (gmail_transactions), +3 views, +1 procedure, +5 triggers | Risk: Low (additive) |
| **Sync** | MySQL becomes SSOT; Sheets → MySQL only | Risk: Low (unidirectional simplifies conflicts) |
| **Admin** | New procedure for status/expiration changes | Risk: Low (audit trail on all changes) |
| **Validation** | New payment split validation | Risk: Low (prevents data corruption) |

## Support

For issues during migration:
1. Check GitHub Actions logs (Actions tab → "Run Database Migrations" → failed run)
2. Run manual verification queries above
3. Check `schema_migrations` table for partial execution
4. Contact DevOps with error message

---

**Last updated:** 2026-04-03
**Status:** Ready for deployment
