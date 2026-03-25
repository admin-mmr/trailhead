# Troubleshooting Guide

**Last updated**: March 2026

---

## Quick Diagnostics

### Where to look first

| Symptom | Where to look | Likely cause |
|---------|---------------|--------------|
| "Backend call failure" on login | `/api/health` endpoint first, then Azure Log Stream | Missing env var (`NEXTAUTH_URL`, `DATABASE_URL`), DB unreachable, or deploy failure |
| Azure deploy fails | GitHub Actions → build-and-deploy job | TypeScript/lint error; run `npm run build` locally |
| API route returns 500 | Azure Portal → Log Stream or App Insights | Missing env var, DB timeout, or code bug |
| Sync job shows ✅ but DB is empty | Sync artifact `.log` file | Column name mismatch, empty sheet, or stale schema |
| Email not sending | Azure Portal → Communication Services → Log Analytics | `AZURE_COMM_CONNECTION_STRING` missing or wrong |
| Login redirect loop | App Insights or local dev terminal | `NEXTAUTH_SECRET` missing, or `/auth/complete` bridge failing |
| Scheduled sync never runs | GitHub Actions → scheduled workflows tab | Cron syntax wrong, or workflow disabled |

---

## Web App & Login Debugging

### Step 1 — Hit the health check endpoint

Open this in your browser first:

```
https://orange-tree-0d70d110f.4.azurestaticapps.net/api/health
```

This endpoint checks every required env var and attempts a live DB connection. Read the response:

- `"status": "degraded"` → the response body shows exactly which env var is missing or if DB is down — go to Step 2
- **404** → API routes aren't deploying at all — go to Step 4 (check deploy)
- `"status": "ok"` → backend is healthy; the bug is in the login flow — go to Step 3 (read logs)

---

### Step 2 — Check Azure environment variables

```
Azure Portal → Static Web Apps → mmr-webapp → Configuration → Application settings
```

Every one of these must be present and correct:

| Variable | Required value |
|---|---|
| `DATABASE_URL` | `mysql://mmradmin:PASSWORD@mmr-mysql-v4.mysql.database.azure.com:3306/mmrdb?ssl=true` |
| `NEXTAUTH_URL` | **Exact production URL** — `https://orange-tree-0d70d110f.4.azurestaticapps.net` |
| `NEXTAUTH_SECRET` | Random 32-byte base64 string — generate with `openssl rand -base64 32` |
| `JWT_SECRET` | Another random base64 string |
| `GOOGLE_CLIENT_ID` | From Google Cloud Console |
| `GOOGLE_CLIENT_SECRET` | From Google Cloud Console |
| `AZURE_COMM_CONNECTION_STRING` | From Azure Portal → Communication Services → Keys |

> ⚠️ The most common cause of "backend call failure" is `NEXTAUTH_URL` set to `localhost:3000` or missing entirely. It must match the live URL exactly.

After adding or changing any value: click **Save** and wait ~60 seconds for the app to restart before retrying.

---

### Step 3 — Read live application logs

If the health check returns `"ok"` but login still fails, the error is happening inside the auth flow. Read live logs while you attempt to log in:

```
Azure Portal → Static Web Apps → mmr-webapp → Monitoring → Log stream
```

Look for lines containing: `ERROR`, `ECONNREFUSED`, `invalid_grant`, `CallbackRouteError`, `JWTSessionError`.

Or query Application Insights history (last 30 min):
```
traces
| where timestamp > ago(30m)
| where severityLevel >= 2
| order by timestamp desc
| project timestamp, message
```

---

### Step 4 — Check that the latest deploy succeeded

If `/api/health` returns a 404, the API routes aren't live. A failed build can leave a stale version deployed.

```
https://github.com/admin-mmr/trailhead/actions
```

Find the most recent `azure-static-web-apps-*.yml` run. If it failed, expand the **Build and Deploy** step and read the error — usually a TypeScript or lint failure. Fix it, push to `main`, and wait for the new deploy.

Also check deploy history directly:
```
Azure Portal → Static Web Apps → mmr-webapp → Deployment history
```

---

### Step 5 — Check MySQL is reachable from Azure

If the health check shows `"db": "ERROR: ..."`:

**Firewall** (most common):
```
Azure Portal → mmr-mysql-v4 → Connection security → "Allow access to Azure services" = ON
```

**Server paused** (Azure free-tier auto-pauses after inactivity):
```
Azure Portal → mmr-mysql-v4 → Overview → click Start if status is Stopped
```
Wait 60 seconds after starting before retrying — cold starts are slow.

**Wrong password in `DATABASE_URL`**: re-enter the secret in Azure Configuration and save.

---

## Live Logs

### Azure web app logs

```bash
# Azure Portal: Static Web Apps → mmr-webapp → Monitoring → Log stream

# Application Insights (queryable history):
# Portal → Application Insights → mmr-webapp-insights → Logs
traces
| where timestamp > ago(1h)
| order by timestamp desc
| project timestamp, message, severityLevel
```

### GitHub Actions logs

```bash
# CLI
gh run list --workflow sync-members-recurring.yml --limit 5
gh run view <run-id> --log
gh run download <run-id>      # downloads artifact .log files

# UI: github.com/admin-mmr/trailhead/actions → click run → expand red step
```

### Database row counts

```bash
mysql-mmr -e "
  SELECT 'members' as tbl, COUNT(*) as rows FROM members
  UNION ALL SELECT 'payments', COUNT(*) FROM payments
  UNION ALL SELECT 'webapp_events', COUNT(*) FROM webapp_events
  UNION ALL SELECT 'gmail_transactions', COUNT(*) FROM gmail_transactions;"

# Check for rows synced in last 24h
mysql-mmr -e "SELECT COUNT(*) as synced_today FROM members WHERE UpdatedAt > NOW() - INTERVAL 1 DAY;"
```

### Local dev server

Server-side logs print to the terminal running `npm run dev`. Client-side logs go to browser DevTools → Console.

```bash
cd web-apps/mmr-webapp && bash start-dev.sh
# add debug logging: console.log('[DEBUG] /api/route hit', { params })
```

---

## Sync Debugging Checklist

### Phase 1: Environment variables (5 min)

```bash
cd basecamp
source load-env.sh

# Check key variables are set
echo "GOOGLE_SHEETS_MEMBERSHIP_ID: ${GOOGLE_SHEETS_MEMBERSHIP_ID:-(NOT SET)}"
echo "MYSQL_HOST: ${MYSQL_HOST:-(NOT SET)}"

# Verify Azure storage string is complete (should be 150+ chars)
echo "Azure string length: ${#AZURE_STORAGE_CONNECTION_STRING}"
[[ "$AZURE_STORAGE_CONNECTION_STRING" == *"AccountKey"* ]] && echo "✓ AccountKey found" || echo "✗ AccountKey missing"
```

### Phase 2: Google Sheets structure (10 min)

Column names must be **PascalCase with no spaces**. The sync does exact string matching.

```bash
python3 basecamp/ops/verify_sheets_structure.py
```

Common column name mistakes:

| ❌ Wrong | ✅ Correct |
|---------|-----------|
| `First Name` | `FirstName` |
| `Last Name` | `LastName` |
| `Payment Check` | `PaymentCheck` |
| `Last Updated` | `LastUpdated` |

### Phase 3: Local dry-run (10 min)

```bash
source basecamp/load-env.sh

# Test without writing to MySQL
python3 basecamp/ops/sync_sheets_to_mysql.py \
  --sheet "Main" \
  --spreadsheet-id "$GOOGLE_SHEETS_MEMBERSHIP_ID" \
  --dry-run

# If dry-run passes, run for real
./basecamp/run-sync.sh Main members
./basecamp/run-sync.sh Payment-History payments
./basecamp/run-sync.sh WebApp-Events payment_events
./basecamp/run-sync.sh Active gmail_transactions
```

### Phase 4: Force full re-sync

If the snapshot comparison thinks nothing changed when data is clearly wrong:

```bash
python3 basecamp/ops/sync_sheets_to_mysql.py \
  --sheet "Main" \
  --spreadsheet-id "$GOOGLE_SHEETS_MEMBERSHIP_ID" \
  --force-full-sync
```

### Phase 5: GitHub Actions secrets

```
https://github.com/admin-mmr/trailhead/settings/secrets/actions
```

Required secrets and current names (see `docs/GITHUB_ACTIONS.md` for full list):
- `GOOGLE_SERVICE_ACCOUNT` — full JSON content (not a file path)
- `MYSQL_HOST`, `MYSQL_USER`, `MYSQL_PASSWORD`, `MYSQL_DATABASE`
- `AZURE_STORAGE_CONNECTION_STRING`
- `MAIL_SERVER`, `MAIL_PORT`, `MAIL_USERNAME`, `MAIL_PASSWORD`, `NOTIFICATION_EMAIL`
- `GOOGLE_SHEETS_MEMBERSHIP_ID`, `GOOGLE_SHEETS_PAYMENTS_ID`, `GOOGLE_SHEETS_WEBAPP_EVENTS_ID`, `GMAIL_TRANSACTION_SHEET_ID`

To check or rotate:
```bash
gh secret list
gh secret set MYSQL_PASSWORD
```

### Phase 6: Azure firewall

If sync works locally but fails in GitHub Actions:
```
Azure Portal → mmr-mysql-v4 → Connection security → "Allow access to Azure services" = ON
```

---

## Common Error Messages

### `Can't connect to MySQL server (Error 2003)`
→ Azure MySQL firewall blocking GitHub Actions. See Phase 6 above.

### `HttpError 403 Google Sheets`
→ Service account doesn't have Viewer access to the spreadsheet. Share each sheet with the service account email (found in the `client_email` field of the JSON key).

### `HttpError 429 Google Sheets`
→ API quota exceeded. Wait 5 minutes and re-run manually.

### `ERROR 1364: Field 'TimeStamp' doesn't have a default value`
→ Row has an empty required field. The sync skips such rows with a warning (fixed in v0.3.0).

### `ERROR 1265: Data truncated for column 'Source'`
→ Fixed in v0.3.0 — `Source` column is now `VARCHAR(50)` instead of `ENUM`.

### `Spreadsheet not found: <id>`
→ Secret value doesn't match the actual sheet URL. Compare `GOOGLE_SHEETS_MEMBERSHIP_ID` etc. against the sheet URLs.

### Sync shows ✅ but 0 rows inserted
- Sheet might be empty — add at least one data row
- Column names don't match PascalCase expectation — run `verify_sheets_structure.py`
- Snapshot thinks nothing changed — use `--force-full-sync`
- Key field collision — all rows share the same key value

### Scheduled workflow stops firing
GitHub auto-disables on repos with no commits for 60 days:
```bash
git commit --allow-empty -m "chore: keep scheduled workflows active"
git push
```
Or: Actions tab → find disabled workflow → Enable workflow.

---

## Escalation Info to Gather

Before asking for help, collect:

- Run ID and workflow name (URL from GitHub Actions)
- Exact error message from the failing step
- Output of `gh secret list` (names only, not values)
- Output of `mysql-mmr -e "SELECT COUNT(*) FROM members;"` (confirms DB access)
- Whether the issue is new or recurring

---

*See also: `docs/GITHUB_ACTIONS.md` for workflow-specific debugging · `docs/AZURE.md` for Azure resource details*
