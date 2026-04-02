# Create V10 Audit Triggers

After dropping the broken triggers, you need to create **new ones** that work with V10 columns.

## What to Create

Two triggers that log member changes to `member_log` table:
- `trg_members_after_insert` — Logs new member inserts
- `trg_members_after_update` — Logs member updates (like status changes)

These use the correct V10 column names:
- ✅ `LastLogin` (not `LastLoginDate`)
- ✅ No `WebApp`, `PaymentCheck`, or `ProfileLastUpdated`

## Steps

1. Go to GitHub Actions → **Create V10 Audit Triggers** workflow (`.github/workflows/create-v10-triggers.yml`)
2. Click **"Run workflow"** button
3. Keep default: `audit_only: true`
4. Click **"Run workflow"** (blue button)
5. Wait ~1 minute
6. Check logs for: `✅ V10 audit triggers created successfully`

## Verify

The workflow will show the current triggers at the end. You should see:
- ✅ trg_members_after_insert
- ✅ trg_members_after_update
- ✅ members_insert_created_unix
- ✅ members_insert_lastlogin_unix
- ✅ members_update_created_unix
- ✅ members_update_lastlogin_unix

All 6 should be present.

## Then Retry Cron

After triggers are created, re-run the member status update and it should succeed!

---

## What the Triggers Do

When you run `UPDATE members SET Status = ...`:
1. The update completes
2. `trg_members_after_update` trigger fires
3. Inserts a row into `member_log` with the new values
4. Audit trail is created ✅

Without these triggers, the cron job fails because it can't log the changes.
