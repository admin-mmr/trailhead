# Start Debugging Here

**Status**: ✅ Current
**Last Updated**: March 22, 2026
**Purpose**: Fast-path guide to reading live logs and diagnosing failures

---

## 🔴 Production is broken — where do I look first?

### 1. Azure Static Web App — live application logs

Your web app runs on Azure Static Web Apps. Server-side (API route) logs stream to **Application Insights** and are also visible in the Azure portal.

**Option A — Azure Portal (quickest)**
```
Azure Portal → Static Web Apps → mmr-webapp-prod
→ Monitoring → Log stream
```
This shows real-time stdout/stderr from API routes as requests arrive.

**Option B — Application Insights (queryable history)**
```
Azure Portal → Application Insights → mmr-webapp-insights
→ Logs → Run this query:

traces
| where timestamp > ago(1h)
| order by timestamp desc
| project timestamp, message, severityLevel
```

**Option C — `az` CLI (terminal)**
```bash
# Tail the last 50 log lines from your Static Web App
az monitor app-insights query \
  --app mmr-webapp-insights \
  --analytics-query "traces | order by timestamp desc | take 50" \
  --resource-group mmr-rg \
  --output table
```

**Option D — Deployment / build logs**
```
Azure Portal → Static Web Apps → mmr-webapp-prod → Deployment history
→ Click latest deployment → View build logs
```
These show the output of `npm run build` and deployment steps from the GitHub Action.

---

### 2. GitHub Actions — CI/CD pipeline logs

Every push triggers the Azure deploy workflow. Every 6 hours the sync workflows fire.

**View logs in the GitHub UI:**
```
https://github.com/admin-mmr/trailhead/actions
→ Click the workflow run
→ Click the job (e.g. "build-and-deploy")
→ Expand any step to see stdout
```

**Download full logs (keeps 30 days):**
```
Workflow run page → ⋯ menu (top right) → Download log archive
```
The zip contains one `.txt` file per job step.

**Trigger a run manually to test:**
```bash
gh workflow run azure-static-web-apps-orange-tree-0d70d110f.yml
# Then watch it:
gh run watch
```

---

### 3. Sync jobs — log artifacts

Each sync workflow uploads a `.log` artifact for 30 days.

```
GitHub Actions → Workflow run → Artifacts section → Download <table>-sync-logs
```

Or fetch via CLI:
```bash
# List artifacts for the latest run of a workflow
gh run list --workflow sync-members-recurring.yml --limit 5
gh run download <run-id>          # downloads all artifacts to ./
```

---

### 4. Database — check live row counts and recent errors

```bash
# Quick sanity check from your terminal
mysql-mmr -e "
  SELECT table_name, table_rows
  FROM information_schema.tables
  WHERE table_schema = 'mmrdb'
  ORDER BY table_name;"

# Check for members synced in the last 24h
mysql-mmr -e "
  SELECT COUNT(*) as synced_today
  FROM members
  WHERE UpdatedAt > NOW() - INTERVAL 1 DAY;"

# Check most recent activity_log entries
mysql-mmr -e "
  SELECT CreatedAt, action, details
  FROM activity_log
  ORDER BY CreatedAt DESC
  LIMIT 20;"
```

---

### 5. Local dev — where do server logs print?

When running `npm run dev` (via `start-dev.sh`), server-side logs go to the **terminal window** running the dev server. Client-side logs go to **browser DevTools → Console**.

```bash
# Start dev server (logs appear in this terminal)
cd web-apps/mmr-webapp && bash start-dev.sh

# In a second terminal, watch for errors live:
# (the dev server already tails its own output — just keep that terminal visible)
```

To add temporary debug logging to an API route:
```ts
console.log('[DEBUG] /api/auth/forgot-password hit', { email })
```
This prints immediately in the `start-dev.sh` terminal.

---

## Common failure scenarios

| Symptom | Where to look | Likely cause |
|---------|---------------|--------------|
| Azure deploy fails | GitHub Actions → build-and-deploy job | TypeScript or lint error; run `npm run build` locally first |
| API route returns 500 | Azure Log Stream or Application Insights | Missing env var, DB connection timeout, or code bug |
| Sync job shows ✅ but DB is empty | Sync artifact `.log` file | Column name mismatch, empty sheet, or schema_migrations out of sync |
| Email not sending | Azure Portal → Communication Services → Log Analytics | `AZURE_COMM_CONNECTION_STRING` missing or invalid |
| Login redirects loop | App Insights or local dev terminal | `NEXTAUTH_SECRET` missing, or `/auth/complete` bridge failing |
| Scheduled sync never runs | GitHub Actions → scheduled workflows tab | Cron expression wrong, or workflow disabled in Actions tab |

---

## Related guides

- [`GITHUB_ACTIONS_DEBUGGING.md`](GITHUB_ACTIONS_DEBUGGING.md) — Deep-dive on scheduled workflow failures
- [`TROUBLESHOOTING_CHECKLIST.md`](TROUBLESHOOTING_CHECKLIST.md) — Systematic step-by-step checklist
- [`DEBUG_SYNC_SETUP.md`](DEBUG_SYNC_SETUP.md) — Sync-specific debugging
- [`AZURE_RESOURCES.md`](AZURE_RESOURCES.md) — All Azure service names and resource group info
