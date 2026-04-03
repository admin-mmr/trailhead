# Migration V006: Quick Reference

## TL;DR

**File:** `db/MIGRATION_V006_mysql_ssot.sql` (514 lines)
**Strategy:** ALTER for member_log (preserves 10K+ rows), DROP/MIGRATE for gmail_transactions (restructure PK)
**Risk:** LOW-MEDIUM; data-preserving migration with full backup strategy

---

## What Changes

### ✅ member_log (ALTER TABLE — Existing Data Preserved)
```
ALTER LoggingTime → DEFAULT CURRENT_TIMESTAMP
ALTER Status → enum('active','expired','inactive','pending','lifetime')
ALTER ChangeType → COMMENT 'INSERT, UPDATE, or DELETE'
DROP Info column
DROP LastLogin column (kept only in members table)
ALTER Notes → COMMENT 'Captures the combined history including Admin Overrides'
```

### ✅ gmail_transactions (RENAME/MIGRATE — Full Data Copy)
```
Old Primary Key: MessageId
New Primary Key: TransactionNumber

New columns:
  • Notes — Split summary (auto-updated by sp_link_transaction)
  • UpdatedAt — Last link timestamp
```

### ✅ New Tables
- `submissions` (from webapp_events)
- `admin_member_overrides` (audit trail)

### ✅ New Triggers (9 total)
```
members_before_update        → Block direct Expiration updates
trg_payments_auto_fill       → Auto-fill from gmail_transactions
trg_payments_limit_check_insert
trg_payments_limit_check_update → Validate split amounts
trg_payments_post_process    → Membership→member sync
trg_members_after_insert     → Audit logging
trg_members_after_update     → Audit logging
members_insert/update_*_unix → Unix timestamp tracking
```

### ✅ New Procedures (2 total)
```
sp_admin_update_member_status    → Safe admin overrides
sp_link_transaction              → Admin-driven payment splits
```

### ✅ New Views (3 total)
```
v_payment_details              → (existing, enhanced)
v_gmail_split_audit (NEW)      → Shows unallocated balances per transaction
```

---

## Execution

### Local (Staging Test)
```bash
source load-env.sh
mysql-mmr < db/MIGRATION_V006_mysql_ssot.sql
```

### Via GitHub Actions
```
Push db/MIGRATION_V006_mysql_ssot.sql to main
→ run-db-migrations.yml auto-triggers
→ Connects to Azure MySQL via secrets (MYSQL_HOST, MYSQL_USER, MYSQL_PASSWORD, MYSQL_DATABASE)
→ Runs migration
→ Verifies schema_migrations table
```

---

## Validation (After Migration)

```sql
-- Verify member_log preserved
SELECT COUNT(*) FROM member_log;
SHOW COLUMNS FROM member_log WHERE Field = 'Status';

-- Verify gmail_transactions migrated
SELECT COUNT(*) FROM gmail_transactions;
DESCRIBE gmail_transactions;

-- Verify new tables
SELECT COUNT(*) FROM submissions;
SELECT COUNT(*) FROM admin_member_overrides;

-- Verify triggers
SHOW TRIGGERS WHERE `Table` IN ('members', 'payments');

-- Verify procedures
SHOW PROCEDURE STATUS WHERE Name IN ('sp_admin_update_member_status', 'sp_link_transaction');

-- Verify views
SELECT COUNT(*) FROM v_gmail_split_audit;
SELECT COUNT(*) FROM v_payment_details;
```

---

## Key Design Decisions

| Decision | Why |
|----------|-----|
| ALTER member_log instead of DROP/CREATE | Preserves 10,000+ audit log rows; only schema changes applied |
| DROP/RENAME gmail_transactions | Restructure needed (TransactionNumber becomes PRIMARY KEY); data still preserved via backup |
| 2 split validation triggers (insert + update) | INSERT validates on creation; UPDATE validates if amount modified |
| trg_payments_post_process after insert | Runs Membership payment→member sync AND submission approval atomically |
| sp_link_transaction for splits | Admin tool for linking payments to specific members when amounts split |
| v_gmail_split_audit view | Easy visibility into unallocated transaction balances |

---

## Timeline

1. **Before migration:** Backup database (contact DevOps)
2. **Staging test:** Run migration, validate 4 queries above
3. **Production:** Maintenance window, run migration, verify results
4. **Post-check:** Run validation queries, monitor admin/sync logs

---

## Rollback

If migration fails:
1. Stop all app processes
2. Restore database from pre-migration backup
3. Contact DevOps for support

**Note:** gmail_transactions backup table is dropped after migration; if full rollback needed within 1 hour, restore from database snapshot instead.

---

## Success Criteria

✅ All ALTER TABLE commands complete without error
✅ gmail_transactions row count matches pre-migration count
✅ member_log has DEFAULT CURRENT_TIMESTAMP on LoggingTime
✅ All 9 triggers created successfully
✅ Both procedures callable
✅ All 3 views queryable
✅ schema_migrations table has version '006' entry

---

## Related Files

- `MIGRATION_V006_CHANGES_SUMMARY.md` — Detailed breakdown
- `MIGRATION_V006_GUIDE.md` — Full reference documentation
- `.github/workflows/run-db-migrations.yml` — Automation workflow
- `db/schema_plan.sql` — Source of truth schema
- `db/schema_snapshot.sql` — Current production schema

---

**Status:** ✅ Ready for staging test
**Last updated:** 2026-04-03 20:35 UTC
