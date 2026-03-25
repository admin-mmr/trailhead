# GitHub Actions — Setup, Secrets & Debugging

**Last updated**: March 2026
**Repo**: `https://github.com/admin-mmr/trailhead`

---

## Workflows Overview

7 workflows live in `.github/workflows/`:

| Workflow file | Trigger | What it does |
|---|---|---|
| `azure-static-web-apps-*.yml` | Push to `main` | Build + deploy webapp to Azure |
| `sync-all-sheets-ordered.yml` | Every 6h + manual | Orchestrates 4-table **sequential** sync (respects FK order) |
| `sync-gmail-transactions-recurring.yml` | Every 6h | Gmail Transactions sheet → `gmail_transactions` |
| `sync-payments-recurring.yml` | Every 6h | Payment-History sheet → `payments` |
| `sync-webapp-events-recurring.yml` | Every 6h | WebApp-Events sheet → `webapp_events` |
| `sync-members-recurring.yml` | Every 6h | Main sheet → `members` |
| `sync-sheets-to-mysql.yml` | Nightly 02:00 UTC | Legacy fallback full sync |

**Sequential sync order** (FK-safe):
`gmail_transactions → payments → payment_events → members`

**Staggered individual sync start times** (UTC):

| Table | Times |
|-------|-------|
| members | 00:00, 06:00, 12:00, 18:00 |
| payments | 01:00, 07:00, 13:00, 19:00 |
| webapp_events | 02:00, 08:00, 14:00, 20:00 |
| gmail_transactions | 03:00, 09:00, 15:00, 21:00 |

---

## GitHub Secrets Setup

Go to: **Settings → Secrets and variables → Actions → New repository secret**

### Required Secrets (15 total)

```
GOOGLE_SERVICE_ACCOUNT
  → Complete service account JSON from Google Cloud Console

GOOGLE_SHEETS_MEMBERSHIP_ID
  → Sheet ID from "Main" sheet URL

GOOGLE_SHEETS_PAYMENTS_ID
  → Sheet ID from "Payment-History" sheet URL

GOOGLE_SHEETS_WEBAPP_EVENTS_ID
  → Sheet ID from "WebApp-Events" sheet URL

GMAIL_TRANSACTION_SHEET_ID
  → Sheet ID from "Active" sheet URL (separate spreadsheet)

MYSQL_HOST
  → mmr-mysql-v4.mysql.database.azure.com

MYSQL_USER
  → mmradmin

MYSQL_PASSWORD
  → MySQL password (from Azure → Connection strings)

MYSQL_DATABASE
  → mmrdb

AZURE_STORAGE_CONNECTION_STRING
  → From Azure Portal → Storage Account → Access keys

MAIL_SERVER
  → smtp.gmail.com (or your SMTP server)

MAIL_PORT
  → 465 (SSL) or 587 (STARTTLS)

MAIL_USERNAME
  → Gmail address used for notifications

MAIL_PASSWORD
  → Gmail App Password — 16 chars, NOT your regular Gmail password

NOTIFICATION_EMAIL
  → Where failure alerts are sent (e.g. admin@mmrunners.org)
```

### How to get a Google Sheets ID

From any sheet URL:
```
https://docs.google.com/spreadsheets/d/1a2b3cABC.../edit
                                       ↑ This long string is the ID
```

### How to get a Gmail App Password

1. `https://myaccount.google.com/security` → enable 2FA
2. Security → App passwords → Mail + Windows
3. Copy the 16-character password → paste as `MAIL_PASSWORD`

### Rotating a secret

```bash
gh secret set MYSQL_PASSWORD
# paste new value at prompt
```

---

## Manual Trigger

```bash
# via CLI
gh workflow run sync-members-recurring.yml
gh run watch

# via GitHub UI
Actions → workflow → "Run workflow" → select branch → Run
```

---

## Monitoring & Logs

### Check recent runs
```bash
gh run list --workflow sync-members-recurring.yml --limit 10
gh run view <run-id> --log
gh run download <run-id>   # downloads log artifacts locally
```

### Artifact logs
Each sync workflow uploads a `.log` artifact (retained 30 days):
- `members-sync-logs/`
- `payments-sync-logs/`
- `webapp-events-sync-logs/`
- `gmail-transactions-sync-logs/`

### Verify DB after a sync
```bash
mysql-mmr -e "
  SELECT 'members' as tbl, COUNT(*) as rows FROM members
  UNION ALL SELECT 'payments', COUNT(*) FROM payments
  UNION ALL SELECT 'webapp_events', COUNT(*) FROM webapp_events
  UNION ALL SELECT 'gmail_transactions', COUNT(*) FROM gmail_transactions;"
```

---

## Debugging Guide

### When a failure alert arrives

1. Click the run link in the alert email, or go to `https://github.com/admin-mmr/trailhead/actions`
2. Click the job → click the red ✗ step — last lines have the actual error
3. Diagnose by error type below

---

### Error: MySQL connection (Error 2003 / ETIMEDOUT)

```
Can't connect to MySQL server on 'mmr-mysql-v4.mysql.database.azure.com:3306' (110)
```

In order of likelihood:

**1. Azure MySQL firewall blocks GitHub Actions IPs** (most common)
```
Azure Portal → mmr-mysql-v4 → Connection security → "Allow access to Azure services" = ON
```

**2. Wrong `MYSQL_HOST` secret** — confirm value is `mmr-mysql-v4.mysql.database.azure.com`

**3. MySQL server paused** (Azure free tier auto-pauses):
```
Azure Portal → mmr-mysql-v4 → Overview → click Start if stopped
```
First connection after cold start takes 30–60 seconds.

**4. SSL mismatch** — test locally:
```bash
mysql -h mmr-mysql-v4.mysql.database.azure.com -u mmradmin -p --ssl-mode=REQUIRED mmrdb -e "SELECT 1;"
```

---

### Error: Google Sheets API (403 / 429)

**403 Permission denied:**
```bash
# Get service account email from the secret
gh secret view GOOGLE_SERVICE_ACCOUNT | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['client_email'])"
```
Then: open each Google Sheet → Share → confirm that email has Viewer access.

**429 Quota exceeded:**
Stagger cron times so workflows don't overlap — they're already offset by 1h in current config. If it still hits, wait 5 min and re-run manually.

**Sheet not found:**
```
Spreadsheet not found: <id>
```
Compare `GOOGLE_SHEETS_MEMBERSHIP_ID` etc. against the actual sheet URLs.

---

### Error: Sync completes but 0 rows inserted

**Snapshot thinks nothing changed** — force a full re-sync:
```bash
python3 basecamp/ops/sync_sheets_to_mysql.py \
  --sheet "Main" \
  --spreadsheet-id "$GOOGLE_SHEETS_MEMBERSHIP_ID" \
  --force-full-sync
```

**Column name mismatch** — run verification:
```bash
source basecamp/load-env.sh
python3 basecamp/ops/verify_sheets_structure.py
```

**Sheet is empty** — check that at least 1 data row exists in each sheet.

---

### Error: SMTP / email notification failures

```
Error: SMTP connection failed
```

- `MAIL_PASSWORD` must be a Gmail **App Password** (16 chars), not your regular password
- `MAIL_PORT` should be `465` (SSL) or `587` (STARTTLS)
- The email failure does **not** mean the sync failed — check the sync step separately

---

### Scheduled runs stopped firing

GitHub auto-disables scheduled workflows on repos with no commits for **60 days**.

Re-enable:
```
GitHub → Actions tab → find disabled workflow → "Enable workflow"
```
Or push an empty commit:
```bash
git commit --allow-empty -m "chore: keep scheduled workflows active"
git push
```

Verify cron syntax (GitHub uses UTC) at `https://crontab.guru/`

---

### Concurrent runs interfere with each other

Add concurrency control to prevent overlapping runs of the same workflow:
```yaml
concurrency:
  group: sync-${{ github.workflow }}
  cancel-in-progress: false   # queue, don't cancel
```

---

## Modifying Schedules

Edit the `cron` expression in `.github/workflows/<workflow>.yml`:

```yaml
# Every hour
- cron: '0 * * * *'

# Every 3 hours
- cron: '0 0,3,6,9,12,15,18,21 * * *'

# Once daily at 2 AM UTC
- cron: '0 2 * * *'
```

Commit and push — new schedule is active immediately.

---

## Disabling / Enabling a Workflow

```
Actions tab → workflow → "..." menu → Disable workflow
Actions tab → workflow → Enable workflow
```

---

## Known Fixes Applied (History)

These issues were found and fixed as of v0.3.0 (March 2026):

- **Secret name mismatch** — workflows now use `GOOGLE_SERVICE_ACCOUNT` (not `GOOGLE_APPLICATION_CREDENTIALS`) and individual `MYSQL_*` secrets (not a combined `DATABASE_URL`)
- **Simultaneous FK violations** — fixed by `sync-all-sheets-ordered.yml` sequential `needs` chaining
- **"First sync" on every run** — fixed by storing snapshot JSON in MySQL (`sync_snapshots` table) instead of Azure Blob
- **`run-sync.sh` key fields** — `gmail_transactions` uses `MessageId` (not `TransactionID`); all 4 key fields corrected

---

*See also: `docs/TROUBLESHOOTING.md` for systematic debugging · `docs/AZURE.md` for Azure resource details*
