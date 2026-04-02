# Deployment Guide: Unix Timestamp Sync Fix

Complete step-by-step guide to deploy the timezone-invariant sync fix.

---

## Overview
This deployment consists of:
1. **Google Apps Script** (GAS) — Generates Unix timestamps when writing to Sheets
2. **MySQL Database** — New Unix columns + backfill
3. **Python Flask** (`mmr-admin`) — Uses Unix timestamps for conflict resolution

All components are **backward compatible** — old records without Unix timestamps still sync correctly.

---

## Pre-Deployment Checklist

- [ ] Code reviewed and syntax-checked
- [ ] Backups taken of MySQL database
- [ ] Downtime window scheduled (if needed) — typically <5 min
- [ ] Team notified of sync behavior changes

---

## Deployment Steps

### Phase 1: Database (2 minutes)

**1. Apply MySQL Migration**

```bash
# Connect to Azure MySQL and apply migration
# NOTE: Unix columns already exist in schema; this adds missing indices and backfills any NULL values
mysql-mmr < db/migrations/0016_add_unix_timestamp_columns.sql
```

**Verify:**
```sql
-- Check all Unix columns exist with indices
SHOW INDEX FROM members WHERE Key_name LIKE '%unix%';
-- Should show: idx_members_updated_at_unix, idx_members_last_login_date_unix,
--              idx_members_profile_last_updated_unix, idx_members_created_at_unix

SHOW INDEX FROM webapp_events WHERE Key_name LIKE '%unix%';
-- Should show: idx_webapp_events_timestamp_unix, idx_webapp_events_expires_at_unix,
--              idx_webapp_events_approval_date_unix

SHOW INDEX FROM payments WHERE Key_name LIKE '%unix%';
-- Should show: idx_payment_history_processed_date_unix
```

**2. Run Backfill Verification Script**

```bash
cd mmr-admin
source venv/bin/activate
python3 backfill_unix_timestamps.py
```

Expected output:
```
[INFO] Starting Unix timestamp backfill...
[INFO] Backfilling members table...
[INFO]   updated_at_unix: updated 245 records
[INFO]   last_login_date_unix: updated 312 records
[INFO]   profile_last_updated_unix: updated 189 records
[INFO]   created_at_unix: updated 456 records
[INFO] Backfilling webapp_events table...
[INFO]   timestamp_unix: already backfilled (0 records to update)
[INFO]   expires_at_unix: already backfilled (0 records to update)
[INFO]   approval_date_unix: already backfilled (0 records to update)
[INFO] Backfilling payment_history table...
[INFO]   processed_date_unix: updated 1203 records
[INFO] Verifying backfill...
[INFO]   members.updated_at_unix: ✓ All records have Unix timestamps
[INFO]   ✓ Verification successful
```

---

### Phase 2: Google Apps Script (2 minutes)

**1. Deploy GAS Code**

From the MMR Google Sheets repository or local clone:

```bash
cd web-apps/gas/membership
npm run build
clasp push
```

Check for deployment success:
```
Pushed 4 files.
```

**2. Verify Sheets Columns Exist**

In the Membership Master sheet, scroll right to columns Z, AA, AB, AC:
- Z: `LastUpdatedUnix` (should have numeric values, e.g., 1743667323)
- AA: `LastLoginDateUnix`
- AB: `ProfileLastUpdatedUnix`
- AC: `CreatedUnix`

(These will auto-populate when GAS next writes to a member row.)

---

### Phase 3: Python Flask (5 minutes)

**1. Deploy to Azure App Service**

```bash
# From repo root
git add mmr-admin/sync_engine.py mmr-admin/api_sheets_sync.py mmr-admin/backfill_unix_timestamps.py
git commit -m "feat: Add Unix timestamp conflict resolution for timezone-invariant sync"
git push origin main

# Azure automatic deployment (or manual via Azure Portal)
```

**2. Verify Deployment**

Check Flask logs in Azure:

```bash
# Via Azure CLI
az webapp log tail -n mmr-admin -g <resource-group>

# Or via Azure Portal → App Service → Log Stream
```

Look for log messages like:
```
[INFO] mmr-admin started successfully
[DEBUG] resolve_conflict_unix imported and ready
```

---

## Testing (10 minutes)

### Test 1: Manual Sync Trigger

1. Go to `https://admin.mmr.local/sync` (admin dashboard)
2. Click **👥 Members Table** → **Sync LastUpdated**
3. Check logs for Unix timestamp comparisons:

Expected log output:
```
[INFO] Running _sync_members_to_mysql...
[DEBUG] Comparing member M001 with sheets row
[DEBUG] Decision: MySQL newer (Unix): 1743667500 > 1743667470 (adjusted -10s)
[DEBUG] Syncing M001 to Sheets (MySQL newer)
[INFO] Sync complete: 245 members, 12 updated, 3 appended
```

### Test 2: Verify Unix Columns Populated

```bash
# Check that recent updates have Unix timestamps
mysql-mmr -e "
  SELECT MemberID, updated_at, updated_at_unix
  FROM members
  WHERE updated_at_unix > 0
  LIMIT 5;
"
```

Expected:
```
MemberID | updated_at          | updated_at_unix
M001     | 2026-04-01 12:34:56 | 1743667496
M002     | 2026-04-01 12:35:12 | 1743667512
...
```

### Test 3: Timezone Edge Case (Optional)

If you want to thoroughly test the fix:

1. Update a member in MySQL with EDT timestamp
2. Update the same member in Sheets with UTC timestamp (same moment in time)
3. Trigger sync
4. Verify correct "winner" is chosen (should match based on Unix value, not string)

Example:
```sql
-- Set member in MySQL to 2026-04-01 04:02:03 EDT (= 08:02:03 UTC)
UPDATE members SET updated_at = '2026-04-01 04:02:03', updated_at_unix = 1743667323
WHERE MemberID = 'TEST001';

-- Sheets has 2026-04-01 08:02:03 UTC = 1743667323 (same instant)
-- Sync should recognize they're the same timestamp (within 10s buffer)
```

---

## Rollback Plan (If Needed)

If issues arise after deployment:

### Quick Rollback (Revert to datetime comparison)

```bash
# Revert Flask deployment
git revert HEAD
git push origin main
# Wait for auto-deployment

# GAS — revert to previous version
# (Keep GAS updated; Unix fields won't hurt even if not used)
```

### Full Rollback (Remove Unix columns)

```bash
# MySQL
mysql-mmr < db/migrations/rollback_0016_remove_unix_columns.sql

# Python — restore original sync_engine.py from git
git show HEAD~1:mmr-admin/sync_engine.py > mmr-admin/sync_engine.py

# Deploy
git add mmr-admin/sync_engine.py
git commit -m "revert: Remove Unix timestamp support"
git push origin main
```

---

## Post-Deployment Validation

### Day 1: Monitor Logs
- Check Azure App Service logs for any new errors
- Monitor `/api/sync/status` endpoint for job failures
- Watch for any parse_datetime warnings (should be gone)

### Day 2-3: Run Full Sync Cycle
```bash
# Trigger all three sync operations to ensure stability
GET /api/sync/members      # MySQL → Sheets
GET /api/sync/events       # MySQL → Sheets
GET /api/sync/payments     # MySQL → Sheets
```

### Day 7: Verify Data Integrity
```bash
# Spot-check a few member records
SELECT MemberID, updated_at, updated_at_unix
FROM members
WHERE updated_at IS NOT NULL
LIMIT 10;

# All updated_at_unix should be > 0 (populated)
# All should match UNIX_TIMESTAMP(updated_at)
```

---

## Documentation Updates

- [ ] Update runbook with new Unix timestamp behavior
- [ ] Document the 10-second buffer in sync spec
- [ ] Add troubleshooting section for Unix timestamp issues

---

## Success Criteria

✅ Migration applied successfully (no errors)
✅ Backfill script runs without warnings
✅ GAS deploys and webhooks work
✅ Flask syncs use Unix comparison (see logs)
✅ Members table has Unix values populated
✅ No parse_datetime errors in logs
✅ Timezone edge cases resolve correctly

---

## Support

If issues occur:

1. **Check logs** — Azure App Service → Log Stream
2. **Verify migration** — `SHOW COLUMNS FROM members;` should show unix columns
3. **Backfill check** — Run `backfill_unix_timestamps.py` again
4. **Test sync** — Manual trigger with logging enabled

Contact: [Dev team Slack channel]
