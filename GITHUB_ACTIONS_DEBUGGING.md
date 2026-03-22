# GitHub Actions Debugging Manual

**Status**: ✅ Current
**Last Updated**: March 22, 2026
**Purpose**: Ops manual for diagnosing and fixing GitHub Actions failures — especially scheduled sync workflows
**Audience**: Anyone on-call when a sync alert email arrives

---

## Quick orientation

We run **7 workflows** in `.github/workflows/`:

| Workflow file | Trigger | What it does |
|---|---|---|
| `azure-static-web-apps-*.yml` | Push to `main` | Build + deploy webapp to Azure |
| `sync-all-sheets-ordered.yml` | Every 6h + manual | Orchestrates 4-table sequential sync |
| `sync-gmail-transactions-recurring.yml` | Every 6h | Syncs Gmail Transactions sheet → `gmail_transactions` |
| `sync-payments-recurring.yml` | Every 6h | Syncs Payment-History sheet → `payments` |
| `sync-webapp-events-recurring.yml` | Every 6h | Syncs WebApp-Events sheet → `webapp_events` |
| `sync-members-recurring.yml` | Every 6h | Syncs Main sheet → `members` |
| `sync-sheets-to-mysql.yml` | Nightly 02:00 UTC | Legacy nightly full sync (kept as fallback) |

Scheduled workflows share GitHub Actions runners — they are **not guaranteed to fire at the exact cron time** and can be delayed up to 15 minutes under load.

---

## Step 1 — Identify which run failed

```
https://github.com/admin-mmr/trailhead/actions
```

The failure email links directly to the run. You can also filter by workflow:
```bash
gh run list --workflow sync-members-recurring.yml --limit 10
```

Status codes you'll see:
- `success` — all steps passed
- `failure` — at least one step failed and `continue-on-error` was not set
- `cancelled` — run exceeded `timeout-minutes` or was manually cancelled
- `skipped` — job's `if:` condition evaluated to false

---

## Step 2 — Read the logs

### In the GitHub UI
1. Click the failing run.
2. Click the job name (e.g. `sync-members`).
3. Each step is expandable — click the red ✗ step first.
4. The last few lines usually contain the actual error.

### Via CLI
```bash
# Get the run ID
gh run list --workflow sync-members-recurring.yml --limit 3

# View logs in terminal
gh run view <run-id> --log

# Download full log archive (one .txt per step)
gh run download <run-id>
```

### Artifact logs
Most sync workflows upload a `.log` artifact:
```bash
gh run download <run-id>          # saves artifacts to ./
cat members-sync-logs/sync-members.log
```

---

## Step 3 — Diagnose by error type

### 3a. MySQL connection timeout (Error 2003 / ETIMEDOUT)

```
Can't connect to MySQL server on 'mmr-mysql-v4.mysql.database.azure.com:3306' (110)
```

**Root cause options** (in order of likelihood):

1. **Azure MySQL firewall is blocking GitHub Actions IPs**
   GitHub Actions runners use dynamic IPs. The fix is to allow all Azure service IPs:
   ```
   Azure Portal → mmr-mysql-v4 → Connection security
   → "Allow access to Azure services" = ON
   ```
   Alternatively, add the GitHub Meta IP ranges (changes frequently — not recommended):
   ```bash
   curl https://api.github.com/meta | jq '.actions[]'
   ```

2. **`MYSQL_HOST` secret is wrong**
   Correct value: `mmr-mysql-v4.mysql.database.azure.com`
   ```bash
   # Verify the secret is set
   gh secret list
   ```

3. **MySQL server paused (Azure free tier auto-pauses)**
   ```
   Azure Portal → mmr-mysql-v4 → Overview
   ```
   If status is "Stopped", click Start. The first connection after a cold start can take 30–60 seconds.

4. **SSL required but not configured**
   The sync scripts use `ssl_disabled=False`. If the server certificate changed:
   ```bash
   mysql -h mmr-mysql-v4.mysql.database.azure.com -u mmradmin -p --ssl-mode=REQUIRED mmrdb -e "SELECT 1;"
   ```

---

### 3b. Google Sheets API errors

```
HttpError 403: The caller does not have permission
```
or
```
HttpError 429: Quota exceeded
```

**Permission error (403):**
1. Find the service account email in the secret:
   ```bash
   gh secret view GOOGLE_SERVICE_ACCOUNT | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['client_email'])"
   ```
2. Open each Google Sheet → Share → confirm that email has at least Viewer access.

**Quota error (429):**
- Google Sheets API has a default limit of 100 requests per 100 seconds per user.
- With 4 sync workflows running at overlapping times, you can hit this.
- Fix: stagger cron times so workflows don't overlap (they're already offset by 1h in current config).
- Temporary fix: re-run the failed workflow manually after 5 minutes.

**Sheet not found:**
```
Spreadsheet not found: <id>
```
Check the sheet ID secrets match the actual Google Sheet URLs:
```
https://docs.google.com/spreadsheets/d/<SHEET_ID>/edit
```
Compare against `GOOGLE_SHEETS_MEMBERSHIP_ID`, `GOOGLE_SHEETS_PAYMENTS_ID`, etc.

---

### 3c. Python / dependency errors

```
ModuleNotFoundError: No module named 'mysql'
```
or
```
ERROR: Could not find a version that satisfies the requirement ...
```

This means the `pip install` step failed silently. Check the "Install dependencies" step in the logs — it uses `pip install -q` which suppresses output. Switch to verbose temporarily:
```yaml
# In the workflow file, change:
pip install -q mysql-connector-python ...
# To:
pip install mysql-connector-python ... --verbose
```

Also verify `basecamp/requirements.txt` is committed and up to date:
```bash
cat basecamp/requirements.txt
```

---

### 3d. Sync completes but no rows inserted

```
[INFO] Found 0 rows in sheet
```
or
```
[INFO] Sync complete: 0 records inserted
```

**Sheet is empty or has a header-only row** — add data and retry.

**Column names don't match** — the sync script does case-sensitive column matching:
```bash
# Verify what the sheet actually has vs. what the script expects
python3 basecamp/ops/verify_sheets_structure.py
```

**Key field collision** — if all rows share the same key field value, only 1 row is upserted.

**Snapshot thinks nothing changed** — the script compares against a stored snapshot. If the snapshot is corrupted or stale, force a full re-sync:
```bash
python3 basecamp/ops/sync_sheets_to_mysql.py \
  --sheet "Main" \
  --spreadsheet-id "$GOOGLE_SHEETS_MEMBERSHIP_ID" \
  --force-full-sync
```

---

### 3e. Email notification step fails

```
Error: SMTP connection failed
```

The workflows use `dawidd6/action-send-mail@v3`. Required secrets:
- `MAIL_SERVER` — e.g. `smtp.gmail.com`
- `MAIL_PORT` — `465` (SSL) or `587` (STARTTLS)
- `MAIL_USERNAME` — Gmail address
- `MAIL_PASSWORD` — Gmail App Password (**not** your regular Gmail password)
- `NOTIFICATION_EMAIL` — recipient address

Gmail App Passwords require 2FA to be enabled on the account. If the password was recently rotated or 2FA changed, generate a new App Password:
```
Google Account → Security → 2-Step Verification → App passwords
```

**The email step failing does not mean the sync failed** — check the actual sync step outcome separately.

---

### 3f. Workflow never triggered (scheduled run skipped)

GitHub skips scheduled runs if the default branch has had **no commits for 60 days**. This is a GitHub policy to prevent billing abuse on inactive repos.

To re-enable:
```
GitHub repo → Actions tab → Find the disabled workflow → Click "Enable workflow"
```

Or push a trivial commit:
```bash
git commit --allow-empty -m "chore: keep scheduled workflows active"
git push
```

Also check that the cron syntax is valid. GitHub uses UTC, not your local timezone:
```yaml
# Correct: runs at 00:00 UTC every day
- cron: '0 0 * * *'

# Validate at: https://crontab.guru/
```

---

### 3g. Concurrent runs interfere with each other

The individual recurring workflows (`sync-members-recurring.yml`, etc.) and the ordered workflow (`sync-all-sheets-ordered.yml`) can run at the same time — they share the same MySQL tables. This can cause duplicate-key errors or partial writes.

**Add concurrency control** to prevent overlapping runs of the same workflow:
```yaml
concurrency:
  group: sync-${{ github.workflow }}
  cancel-in-progress: false   # queue, don't cancel
```

Add this block at the top level of any sync workflow that touches shared tables.

---

## Step 4 — Manually trigger a workflow to verify the fix

```bash
# Trigger and watch in real time
gh workflow run sync-members-recurring.yml
gh run watch
```

Or via GitHub UI:
```
Actions → workflow → "Run workflow" button → select branch → Run
```

---

## Step 5 — Verify the database after a successful run

```bash
# Quick row counts across all sync tables
mysql-mmr -e "
  SELECT 'members' as tbl, COUNT(*) as rows FROM members
  UNION ALL SELECT 'payments', COUNT(*) FROM payments
  UNION ALL SELECT 'webapp_events', COUNT(*) FROM webapp_events
  UNION ALL SELECT 'gmail_transactions', COUNT(*) FROM gmail_transactions;"

# Check for recently updated rows (should be within the last 6h after a sync)
mysql-mmr -e "
  SELECT MAX(UpdatedAt) as last_sync FROM members;"
```

---

## Step 6 — Secrets management

All workflow credentials are stored as **GitHub repository secrets**:
```
https://github.com/admin-mmr/trailhead/settings/secrets/actions
```

Required secrets and what they map to:

| Secret | Used by | Notes |
|---|---|---|
| `MYSQL_HOST` | All sync workflows | `mmr-mysql-v4.mysql.database.azure.com` |
| `MYSQL_USER` | All sync workflows | `mmradmin` |
| `MYSQL_PASSWORD` | All sync workflows | From Azure MySQL → Connection strings |
| `MYSQL_DATABASE` | All sync workflows | `mmrdb` |
| `GOOGLE_SERVICE_ACCOUNT` | All sync workflows | Full JSON key file content |
| `GOOGLE_SHEETS_MEMBERSHIP_ID` | Members sync | Sheet ID from URL |
| `GOOGLE_SHEETS_PAYMENTS_ID` | Payments sync | Sheet ID from URL |
| `GOOGLE_SHEETS_WEBAPP_EVENTS_ID` | Events sync | Sheet ID from URL |
| `GMAIL_TRANSACTION_SHEET_ID` | Gmail sync | Sheet ID from URL |
| `AZURE_STORAGE_CONNECTION_STRING` | Snapshot storage | From Azure Storage → Access keys |
| `MAIL_SERVER` | Email notifications | `smtp.gmail.com` |
| `MAIL_PORT` | Email notifications | `465` |
| `MAIL_USERNAME` | Email notifications | Gmail address |
| `MAIL_PASSWORD` | Email notifications | Gmail **App Password** (not regular password) |
| `NOTIFICATION_EMAIL` | Email notifications | Where failure emails go |
| `AZURE_STATIC_WEB_APPS_API_TOKEN_*` | Web app deploy | Auto-generated by Azure; do not change |

To rotate a secret:
```bash
gh secret set MYSQL_PASSWORD
# Paste the new value when prompted
```

---

## Escalation checklist

When you've exhausted the steps above, gather this before asking for help:

- [ ] Run ID and workflow name (URL from GitHub Actions)
- [ ] The exact error message from the failing step
- [ ] Output of `gh secret list` (shows secret names only, not values)
- [ ] Output of `mysql-mmr -e "SELECT COUNT(*) FROM members;"` (confirms DB access)
- [ ] Whether the issue is new (first occurrence) or recurring

---

## Related docs

- [`START_DEBUGGING_HERE.md`](START_DEBUGGING_HERE.md) — Live log locations for Azure and GitHub
- [`TROUBLESHOOTING_CHECKLIST.md`](TROUBLESHOOTING_CHECKLIST.md) — Systematic checklist for common issues
- [`GITHUB_SECRETS_QUICK_SETUP.md`](GITHUB_SECRETS_QUICK_SETUP.md) — 5-minute secrets setup reference
- [`AZURE_RESOURCES.md`](AZURE_RESOURCES.md) — Azure service names, resource group, and connection info
- [`SYNC_PIPELINE_COMPLETION.md`](SYNC_PIPELINE_COMPLETION.md) — How the sync pipeline works end to end
