# Build Fix: Removed Dead Code in email/client.ts

## Issue
Build failed with:
```
Type error: Cannot find name 'pool'.
./lib/email/client.ts:117:27
```

## Root Cause
The `sendRenewalReminders()` function in `web-apps/mmr-webapp/lib/email/client.ts` was attempting to use a MySQL `pool` object that was never imported or initialized. This is legacy code that doesn't belong in a Next.js webapp.

## Solution
**Removed the entire `sendRenewalReminders()` function** (lines 111-163).

**Why?**
1. Function was never called anywhere in the codebase
2. Renewal reminders should be sent by the Python cron job (`basecamp/ops/update_member_status.py`), not the web app
3. Web app communicates with MySQL via GAS webhook, not direct database connections
4. This was dead code causing a build error

## File Changed
- `web-apps/mmr-webapp/lib/email/client.ts` — Removed `sendRenewalReminders()` function

## Renewal Reminders
Renewal reminder emails are now handled by:
- **Python script:** `basecamp/ops/update_member_status.py` → calls `sendEmail()` with `emailType: 'renewal_reminder'`
- **Flow:** Cron job queries for expiring members → sends via GAS webhook → tracks via email log
- **Frequency:** As needed (can be scheduled via GitHub Actions)

## Verification
After removing the dead code, the TypeScript compiler should complete without errors.

## Commit
```bash
git add web-apps/mmr-webapp/lib/email/client.ts
git commit -m "fix: Remove dead sendRenewalReminders function (legacy code)"
git push origin main
```
