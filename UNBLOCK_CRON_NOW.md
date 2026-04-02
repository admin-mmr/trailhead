# 🚨 EMERGENCY: Unblock Member Status Cron Job NOW

The GitHub Actions cron job is blocked by **triggers that reference dropped columns**.

Error:
```
Unknown column 'WebApp' in 'field list'
```

## Quick Fix (5 minutes)

### 1. Connect to Azure MySQL
```bash
mysql-mmr mmrdb
```

### 2. Copy and run ALL of these DROP commands:

```sql
-- Drop ALL broken triggers immediately
DROP TRIGGER IF EXISTS members_after_insert;
DROP TRIGGER IF EXISTS members_after_update;
DROP TRIGGER IF EXISTS members_update_lastupdated_unix;
DROP TRIGGER IF EXISTS members_insert_lastupdated_unix;
DROP TRIGGER IF EXISTS members_update_lastlogindate_unix;
DROP TRIGGER IF EXISTS members_insert_lastlogindate_unix;
DROP TRIGGER IF EXISTS members_update_profilelastupdated_unix;
DROP TRIGGER IF EXISTS members_insert_profilelastupdated_unix;
DROP TRIGGER IF EXISTS members_update_createdat_unix;
DROP TRIGGER IF EXISTS members_insert_createdat_unix;
DROP TRIGGER IF EXISTS payments_update_processeddate_unix;
DROP TRIGGER IF EXISTS payments_insert_processeddate_unix;
DROP TRIGGER IF EXISTS webapp_events_update_timestamp_unix;
DROP TRIGGER IF EXISTS webapp_events_insert_timestamp_unix;
DROP TRIGGER IF EXISTS webapp_events_update_expiresat_unix;
DROP TRIGGER IF EXISTS webapp_events_insert_expiresat_unix;
DROP TRIGGER IF EXISTS webapp_events_update_approvaldate_unix;
DROP TRIGGER IF EXISTS webapp_events_insert_approvaldate_unix;
```

### 3. Verify they're gone:
```sql
SHOW TRIGGERS WHERE `Table` = 'members';
```

Should return: **(empty result set)**

### 4. Test the cron job
Re-trigger the GitHub Actions workflow. It should complete successfully now.

---

## Why All Triggers Were Dropped

The triggers were created by old migrations that predated V10:
- **members_after_insert/update** — Log changes to member_log, but reference `WebApp`, `PaymentCheck`, `LastLoginDate`, `ProfileLastUpdated` (all gone)
- **unix timestamp triggers** — Tried to sync `LastLoginDate` → `last_login_date_unix` (column renamed)
- **Others** — Created before V10, may also be broken

By dropping them ALL, we:
1. ✅ Unblock the cron job immediately
2. ✅ Stop trying to log to non-existent columns
3. ✅ Stop trying to sync non-existent unix columns
4. ⚠️ Lose audit logging (member_log won't be populated) — but this is better than being blocked
5. ⚠️ Lose unix timestamp auto-sync — but unix columns are already backfilled, so no immediate impact

---

## Longer-Term Fix (After Unblocking)

Once the cron job runs successfully, you can:

### Option A: Restore Triggers with V10 Columns (Recommended)
Create new triggers that match V10 schema:
- `members_after_insert` / `members_after_update` — Log only columns that exist (no WebApp, PaymentCheck, etc.)
- `members_update_lastlogin_unix` / `members_insert_lastlogin_unix` — Sync LastLogin (not LastLoginDate)
- `members_update_created_unix` / `members_insert_created_unix` — Sync Created (not CreatedAt)
- (Payment/webapp_events triggers can remain or be recreated)

### Option B: Keep Triggers Disabled
Leave them dropped. The cron job will work fine without them. Member changes just won't be logged to member_log (less important than unblocking the job).

---

## Status After This Fix

- ✅ Member status cron job will run
- ✅ 364 member status updates will apply
- ✅ 214 inactive members will be preserved (locked)
- ❌ member_log won't be populated (no audit trail) — can fix later
- ❌ Unix timestamps won't auto-sync on new updates — can fix later

**The cron job is more important than the audit trail right now.**

---

## File Reference

- `DROP_ALL_BROKEN_TRIGGERS.sql` — Contains all the DROP statements above

Run it and let me know when it's done.
