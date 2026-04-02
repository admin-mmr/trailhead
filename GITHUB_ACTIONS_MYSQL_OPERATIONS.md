# GitHub Actions Manual MySQL Operations

A new GitHub Actions workflow has been created for manual MySQL operations on Azure.

## How to Use

### 1. Go to GitHub Actions
Navigate to: `.github/workflows/manual-mysql-operations.yml`

Or direct link: https://github.com/mmrunners/trailhead/actions/workflows/manual-mysql-operations.yml

### 2. Click "Run workflow"

### 3. Select Operation (dropdown menu):
- **drop-broken-triggers** — EMERGENCY: Drop all 18 broken triggers immediately (unblocks cron job)
- **fix-member-log-triggers** — Fix audit triggers with V10 column names (optional, after emergency fix)
- **fix-unix-timestamp-triggers** — Fix unix timestamp triggers with V10 names (optional, after emergency fix)
- **status-check** — Show all triggers and members columns (diagnostic)

### 4. Click "Run workflow" button

## Recommended Execution Order

### Step 1: EMERGENCY FIX (Unblock cron job)
```
Operation: drop-broken-triggers
```
This drops all 18 broken triggers. The cron job will unblock immediately.

### Step 2: Verify (optional)
```
Operation: status-check
```
Shows what triggers exist and what columns are in members table.

### Step 3: Restore Triggers (optional, later)
```
Operation: fix-member-log-triggers
```
Restores audit logging (member_log will be populated again).

```
Operation: fix-unix-timestamp-triggers
```
Restores unix timestamp auto-sync.

## Workflow Details

The workflow:
- ✅ Runs on `ubuntu-latest` (GitHub's runners have MySQL client)
- ✅ Uses your Azure MySQL credentials (from GitHub Secrets)
- ✅ Connects to `mmrdb` database
- ✅ Executes SQL operations
- ✅ Shows results and status
- ✅ Takes ~2-5 minutes per operation

## What Each Operation Does

### drop-broken-triggers
Drops these 18 triggers:
- members_after_insert, members_after_update
- members_update_lastupdated_unix, members_insert_lastupdated_unix
- members_update_lastlogindate_unix, members_insert_lastlogindate_unix (old names)
- members_update_profilelastupdated_unix, members_insert_profilelastupdated_unix (dropped columns)
- members_update_createdat_unix, members_insert_createdat_unix
- payments_update_processeddate_unix, payments_insert_processeddate_unix
- webapp_events_update_timestamp_unix, webapp_events_insert_timestamp_unix
- webapp_events_update_expiresat_unix, webapp_events_insert_expiresat_unix
- webapp_events_update_approvaldate_unix, webapp_events_insert_approvaldate_unix

Result: Cron job runs, but no audit logging or auto-sync.

### fix-member-log-triggers
Recreates 2 triggers for audit logging:
- members_after_insert
- members_after_update

Uses correct V10 column names (LastLogin, not LastLoginDate).
Result: Audit logging resumes.

### fix-unix-timestamp-triggers
Recreates 4 triggers for unix timestamp auto-sync:
- members_update_lastlogin_unix
- members_insert_lastlogin_unix
- members_update_created_unix
- members_insert_created_unix

Uses correct V10 column names.
Result: Unix columns auto-sync on updates.

### status-check
Shows:
- All triggers on members, payments, webapp_events tables
- All columns in members table with types and keys
- Diagnostic info

No changes made.

## After Operations

### After drop-broken-triggers (REQUIRED)
1. Wait ~5 minutes for workflow to complete
2. Manually trigger the member status update: `.github/workflows/update-member-status.yml` → "Run workflow"
3. Check logs — should see "Status breakdown: X active, Y expired, Z inactive, etc."
4. ✅ Cron job unblocked!

### After fix-member-log-triggers (optional)
Verify audit logging works:
```sql
SELECT * FROM member_log ORDER BY LoggingTime DESC LIMIT 5;
```

### After fix-unix-timestamp-triggers (optional)
Verify unix columns update on changes:
```sql
UPDATE members SET LastLogin = NOW() WHERE MemberID = 'A0001';
SELECT LastLogin, last_login_unix FROM members WHERE MemberID = 'A0001';
-- last_login_unix should equal UNIX_TIMESTAMP(LastLogin)
```

## Emergency Contact

If the workflow fails:
1. Check GitHub Actions logs for error details
2. Run `status-check` to see current trigger state
3. Run `drop-broken-triggers` again if needed
4. Contact Azure support if MySQL connectivity issues occur

## File Reference

- `.github/workflows/manual-mysql-operations.yml` — The workflow file
- `DROP_ALL_BROKEN_TRIGGERS.sql` — Reference SQL (same commands in workflow)
- `UNBLOCK_CRON_NOW.md` — Emergency instructions (same as workflow)

---

## Quick Start (TL;DR)

1. Go to GitHub Actions
2. Find "Manual MySQL Operations" workflow
3. Click "Run workflow"
4. Select: **drop-broken-triggers**
5. Click "Run workflow"
6. Wait 5 minutes
7. ✅ Done! Cron job is unblocked
