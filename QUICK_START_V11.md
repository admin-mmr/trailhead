# Quick Start: V11 Implementation (2 Sessions, ~1800 Tokens)

---

## TL;DR: Three-Part Refactor

1. **Rename:** webapp_events → submissions (clearer naming)
2. **Automate:** Add 3 SQL triggers (payment→members, payment→gmail, optional audit)
3. **Simplify:** Remove bidirectional sync; MySQL is SSOT

---

## 📋 Documents (In Order)

1. **CLEANUP_AND_SCHEMA_PLAN.md** — Overview of what's stale vs what to keep
2. **SCHEMA_DESIGN_DECISIONS.md** — Deep dives on view vs update, trigger design, rename rationale
3. **ARCHITECTURE_SUMMARY_V11.md** — Full 9-part breakdown
4. **MIGRATION_V11_TRIGGERS_AND_RENAME.sql** — Ready-to-run SQL (test on staging first!)
5. This file ← You are here

---

## 🚀 Immediate Actions (Next Session)

### Session 1 (Phase 1 + Phase 2): Schema & Triggers (~3 hours)

```bash
# 1. Backup current schema
mysqldump --triggers -h [host] -u [user] -p mmrdb > db/backup_pre_v11.sql

# 2. Test migration on staging (DO NOT RUN ON PRODUCTION YET)
mysql-mmr < MIGRATION_V11_TRIGGERS_AND_RENAME.sql

# 3. Verify in staging
mysql-mmr -e "SHOW TRIGGERS;"
mysql-mmr -e "SELECT * FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='submissions';"

# 4. Test with sample payment (staging)
mysql-mmr -e "INSERT INTO payments (PaymentID, MemberID, PaymentDate, Amount, MembershipType, TransactionReference, Source, CreatedAt)
VALUES ('TEST001', 'M001', NOW(), 100.00, 'Individual Membership', 'TXN-TEST', 'manual', NOW());"

# 5. Check if member was auto-updated
mysql-mmr -e "SELECT MemberID, PaymentDate, Expiration, Status FROM members WHERE MemberID='M001';"

# 6. Update schema snapshot (run on any environment with full db access)
mysqldump --no-data --triggers -h [host] -u [user] -p mmrdb > db/schema_snapshot.sql

# 7. Git commit
git add db/schema_snapshot.sql db/schema_migrations/MIGRATION_V11_TRIGGERS_AND_RENAME.sql
git commit -m "feat: V11 schema — rename submissions + payment automation triggers"
```

### Session 2 (Phase 2 + Phase 3): Code Updates (~2 hours)

```bash
# 1. Update JavaScript
# File: mmr-admin/static/payments.js
# Change: Timestamp → SubmittedAt, ApprovalDate → ApprovedAt, EventID → SubmissionID

# 2. Update Python API
# File: mmr-admin/api_payments.py
# Change: field name mappings in database queries

# 3. Simplify sync_engine.py
# Remove bidirectional logic; keep only:
#   - compare_sync_rows(direction='mysql_to_sheets')
#   - compare_sync_rows(direction='sheets_to_mysql')

# 4. Simplify API endpoints (api_sheets_sync.py)
# Remove conflict resolution from:
#   - _sync_members_to_sheets()
#   - _sync_payments_to_sheets()
#   - _sync_events_to_sheets()

# 5. Test Python imports
python3 mmr-admin/test_imports.py

# 6. Test TypeScript
npm run build --cwd web-apps/mmr-webapp

# 7. Git commit
git add .
git commit -m "refactor: V11 sync simplification — remove bidirectional logic, use triggers"

# 8. Deploy
git push origin main
# (GitHub Actions will run; watch for Azure deploy completion)
```

---

## 🎯 Key Files

| File | Purpose | Size |
|------|---------|------|
| `MIGRATION_V11_TRIGGERS_AND_RENAME.sql` | Ready-to-run SQL migration | 250 lines |
| `SCHEMA_DESIGN_DECISIONS.md` | Architecture rationale + Q&A | 300 lines |
| `ARCHITECTURE_SUMMARY_V11.md` | Full implementation guide | 350 lines |
| `CLEANUP_AND_SCHEMA_PLAN.md` | What to archive + what to keep | 200 lines |

---

## 📊 Impact Summary

### Before V11
```
Members table: 23 columns (including 3 Unix timestamp columns)
webapp_events table: 25 columns (confusing EventID/EventType/EventCategory names)
Sync logic: 290 lines (bidirectional, conflict resolution)
Triggers: 0
Automation: Manual (click buttons in admin portal)
```

### After V11
```
Members table: 23 columns (unchanged)
submissions table: 22 columns (renamed, clearer semantics)
Sync logic: ~100 lines (mysql_to_sheets | sheets_to_mysql only)
Triggers: 3 (automatic payment→member, payment→gmail, optional audit)
Automation: Triggers + GitHub Actions (no manual clicks)
```

**Simplification:** -190 lines Python, +50 lines SQL = **-140 lines net**

---

## ⚠️ Important: Test on Staging First!

1. **Never run MIGRATION_V11 on production directly**
2. **Test on staging environment** (creates real family relationships, verifies triggers fire)
3. **Run manual payment inserts** to confirm auto-updates
4. **Check sync workflow** runs without conflicts

---

## 🧪 Test Scenarios (Staging)

### Test 1: Individual Membership
```sql
-- Setup
INSERT INTO members (MemberID, Email, FirstName, LastName, Type, Status, Created)
VALUES ('M001', 'john@example.com', 'John', 'Doe', 'Individual', 'pending', NOW());

-- Insert payment
INSERT INTO payments (PaymentID, MemberID, PaymentDate, Amount, MembershipType, TransactionReference, Source, CreatedAt)
VALUES ('P001', 'M001', '2026-04-03', 150.00, 'Individual Membership', 'TXN-001', 'manual', NOW());

-- Verify trigger fired
SELECT MemberID, PaymentDate, Expiration, Status FROM members WHERE MemberID='M001';
-- Expected: Status='active', Expiration=2027-04-03
```

### Test 2: Family Membership
```sql
-- Setup: 3 members, same FamilyID
INSERT INTO members (MemberID, Email, FirstName, LastName, Type, FamilyID, Status, Created)
VALUES
  ('M002', 'jane@example.com', 'Jane', 'Smith', 'Family', 'FAM001', 'pending', NOW()),
  ('M003', 'kid1@example.com', 'Child1', 'Smith', 'Family', 'FAM001', 'pending', NOW()),
  ('M004', 'kid2@example.com', 'Child2', 'Smith', 'Family', 'FAM001', 'pending', NOW());

-- Insert payment for primary member
INSERT INTO payments (PaymentID, MemberID, PaymentDate, Amount, MembershipType, TransactionReference, Source, CreatedAt)
VALUES ('P002', 'M002', '2026-04-03', 300.00, 'Family Membership', 'TXN-002', 'manual', NOW());

-- Verify ALL family members got updated
SELECT MemberID, Status, Expiration FROM members WHERE FamilyID='FAM001';
-- Expected: All 3 have Status='active', same Expiration
```

### Test 3: Gmail Link
```sql
-- Setup: pre-populate gmail_transactions
INSERT INTO gmail_transactions (MessageId, TimeStamp, Sender, Amount, TransactionNumber, Subject)
VALUES ('MSG001', NOW(), 'buyer@gmail.com', 150.00, 'TXN-001', 'Payment Confirmation');

-- Insert payment (with matching TransactionReference)
INSERT INTO payments (PaymentID, MemberID, PaymentDate, Amount, MembershipType, TransactionReference, Source, CreatedAt)
VALUES ('P003', 'M001', '2026-04-03', 150.00, 'Individual Membership', 'TXN-001', 'manual', NOW());

-- Verify gmail_transactions was linked
SELECT PaymentID, ProcessedTime, Notes FROM gmail_transactions WHERE MessageId='MSG001';
-- Expected: PaymentID='P003', Notes contains 'Individual Membership for M001'
```

---

## 🔄 Rollback (If Needed)

```bash
# Restore from backup
mysql-mmr < db/backup_pre_v11.sql

# Drop new triggers
mysql-mmr -e "DROP TRIGGER IF EXISTS trg_payments_after_insert_update_members;"
mysql-mmr -e "DROP TRIGGER IF EXISTS trg_payments_after_insert_update_gmail_link;"
mysql-mmr -e "DROP TRIGGER IF EXISTS trg_payments_after_update_members;"

# Drop new view
mysql-mmr -e "DROP VIEW IF EXISTS v_payment_audit;"

# Revert schema snapshot
git checkout db/schema_snapshot.sql

# Revert code
git revert HEAD  # or git reset --hard HEAD~1
```

---

## 📞 Questions?

Refer to:
- **Why the rename?** → SCHEMA_DESIGN_DECISIONS.md (Q3)
- **View vs Update?** → SCHEMA_DESIGN_DECISIONS.md (Q1)
- **How to test triggers?** → This document (Test Scenarios section)
- **What about existing bidirectional code?** → ARCHITECTURE_SUMMARY_V11.md (Part 4)
- **Token budget OK?** → ARCHITECTURE_SUMMARY_V11.md (Part 7)

---

## ✅ Success Checklist

- [ ] Schema renamed (webapp_events → submissions) on staging ✅
- [ ] 3 triggers created and firing on test payments ✅
- [ ] v_payment_audit view works ✅
- [ ] Python tests pass (test_imports.py) ✅
- [ ] TypeScript builds (npm run build) ✅
- [ ] Sample Individual payment → member auto-updated ✅
- [ ] Sample Family payment → all family members auto-updated ✅
- [ ] Gmail transaction auto-linked ✅
- [ ] Sync workflow runs without conflicts ✅
- [ ] Code deployed to production ✅

**After all checks ✅, you're done with V11!**

---

**Estimated total implementation time:** 5 hours across 2 sessions (Phase 1 staging test + Phase 2 code + Phase 3 deploy)

**Next:** Review ARCHITECTURE_SUMMARY_V11.md and SCHEMA_DESIGN_DECISIONS.md, then proceed to staging migration.
