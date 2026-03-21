# Deployment Guide 🚀

How to deploy the trailhead monorepo services to production.

---

## Quick Start Checklist

- [ ] Azure secrets configured in GitHub
- [ ] GitHub Actions workflow runs on push to `main`
- [ ] GAS changes pushed via `clasp push`
- [ ] Database migrations applied to production MySQL
- [ ] Photo pipeline scheduled as cron job

---

## 1. Web App Deployment (Next.js to Azure)

### A. Configure Azure Secrets in GitHub

The GitHub Actions workflow needs the Azure deployment token.

**Step 1: Get the token from Azure Portal**

1. Go to [portal.azure.com](https://portal.azure.com)
2. Find your Static Web App resource (`mmr-webapp`)
3. Click **Manage deployment token** in the left sidebar
4. Copy the token

**Step 2: Add to GitHub Repository**

1. Go to `https://github.com/admin-mmr/trailhead`
2. **Settings → Secrets and variables → Actions**
3. Click **New repository secret**
4. Name: `AZURE_STATIC_WEB_APPS_API_TOKEN_ORANGE_TREE_0D70D110F`
5. Value: paste the token
6. Click **Add secret**

### B. How GitHub Actions Works

Every push to `main` triggers the workflow (`.github/workflows/azure-static-web-apps-*.yml`):

```yaml
on:
  push:
    branches:
      - main

jobs:
  build_and_deploy_job:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - name: Build And Deploy
        uses: Azure/static-web-apps-deploy@v1
        with:
          azure_static_web_apps_api_token: ${{ secrets.AZURE_STATIC_WEB_APPS_API_TOKEN_... }}
          app_location: "web-apps/mmr-webapp"
          action: "upload"
```

**What happens:**
1. GitHub checks out the code
2. Azure's Static Web Apps action builds and deploys
3. Site goes live at `https://www.mmrunners.org`

### C. Before You Push

**Local verification** (always run before pushing):

```bash
cd web-apps/mmr-webapp
npm run verify      # Runs lint + build
```

If it fails, the GitHub Actions will also fail. Fix locally first.

**Example:**
```bash
npm run lint -- --fix   # Auto-fix style issues
npm run build           # Verify build succeeds
git add .
git commit -m "fix: code style"
git push origin main
```

### D. Monitor the Deployment

1. Push to `main`
2. Go to `https://github.com/admin-mmr/trailhead/actions`
3. Watch the workflow run
4. Once it passes (✅), the site is live

If it fails (❌):
- Click the failed run
- Scroll to **Build and Deploy** step
- Read the error message
- Fix locally, commit, and push again

---

## 2. GAS Deployment (Google Apps Script)

### A. Prerequisites

```bash
# Global clasp (should be 3.2.0+)
clasp --version

# Local clasp in gas/membership/
cd web-apps/gas/membership
./node_modules/.bin/clasp --version  # Should match or be newer than global
```

### B. Push Changes

```bash
cd web-apps/gas/membership
npm run build:copy      # Bundles TypeScript into dist/
npm run push            # Deploys to Google Apps Script
```

Expected output:
```
Pushed 30 files.
```

**Troubleshooting:**

| Error | Fix |
|-------|-----|
| `invalid_grant` | Version mismatch. Run `npm install` to update clasp. |
| `Permission denied` | Run `npm run login` first |
| `Project not found` | Check `.clasprc.json` has correct `projectId` |

### C. Schedule Membership Renewal Reminders

In Google Apps Script Editor (https://script.google.com):

1. Open the Membership project
2. **Triggers** (left sidebar)
3. Click **+ Create new trigger**
4. Function: `sendRenewalReminders`
5. Deployment: Head
6. Event source: Time-driven
7. Type of time-based trigger: Day timer
8. Time of day: 8:00 AM
9. Click **Save**

Now the script runs nightly at 8 AM to send renewal reminders.

---

## 3. Database Migrations (MySQL on Azure)

### A. Connect to Production MySQL

```bash
# Install MySQL client (Mac)
brew install mysql-client

# Connect
mysql -h mmr-mysql.mysql.database.azure.com \
      -u mmradmin \
      -p mmrdb

# Type password when prompted
```

### B. Apply Schema Migrations

Migrations live in `basecamp/migrations/` (numbered: `0001_*.sql`, `0002_*.sql`, etc.).

**Check which migrations have been applied:**

```sql
SELECT * FROM schema_migrations;
```

**Apply a new migration:**

```bash
# Read the migration file
cat basecamp/migrations/0003_add_year_born.sql

# Apply it (from MySQL CLI)
mysql -h mmr-mysql.mysql.database.azure.com -u mmradmin -p mmrdb < basecamp/migrations/0003_add_year_born.sql

# Verify it worked
SELECT * FROM schema_migrations;
```

### C. Backup Before Migrations

```bash
# Backup the entire database
mysqldump -h mmr-mysql.mysql.database.azure.com \
          -u mmradmin \
          -p mmrdb > backup_$(date +%Y%m%d).sql
```

Store the backup somewhere safe (Google Drive, local machine).

---

## 4. Photo Pipeline Scheduling (GitHub Actions Cron)

If you want to run the photo pipeline automatically (e.g., nightly processing):

### A. Create a Workflow

```yaml
# .github/workflows/photo-pipeline.yml
name: Photo Pipeline Nightly

on:
  schedule:
    - cron: '0 2 * * *'  # 2 AM UTC daily

jobs:
  process_photos:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-python@v4
        with:
          python-version: '3.11'
      - name: Install dependencies
        run: pip install -r photo-manager/requirements.txt
      - name: Process photos
        env:
          GOOGLE_APPLICATION_CREDENTIALS: ${{ secrets.GOOGLE_SERVICE_ACCOUNT }}
          AZURE_VISION_KEY: ${{ secrets.AZURE_VISION_KEY }}
        run: python photo-manager/src/process_photos.py --event latest
```

### B. Add Secrets to GitHub

1. **Settings → Secrets and variables → Actions**
2. Add:
   - `GOOGLE_SERVICE_ACCOUNT` — contents of service account JSON
   - `AZURE_VISION_KEY` — Azure Computer Vision key

---

## 5. Environment Variables on Azure

The web app needs secrets at runtime. Set them in Azure Static Web Apps settings:

### A. In Azure Portal

1. Go to `https://portal.azure.com`
2. Find Static Web App `mmr-webapp`
3. **Settings → Configuration**
4. Add these **Application settings** (Environment variables):

| Name | Value | Source |
|------|-------|--------|
| `DATABASE_URL` | `mysql://mmradmin:PASSWORD@mmr-mysql.mysql.database.azure.com:3306/mmrdb?ssl=true` | From `.env.local` |
| `JWT_SECRET` | Long random string | From `.env.local` |
| `AZURE_STORAGE_CONNECTION_STRING` | From Azure Storage account | Portal |
| `AZURE_COMM_CONNECTION_STRING` | From Azure Comm Services | Portal |
| `NEXT_PUBLIC_APP_URL` | `https://www.mmrunners.org` | Fixed |

**Critical:** Do NOT commit these to GitHub. They stay in Azure only.

### B. Test in GitHub Actions

To use secrets in workflows (e.g., for testing):

```yaml
- name: Test app
  env:
    DATABASE_URL: ${{ secrets.DATABASE_URL }}
    JWT_SECRET: ${{ secrets.JWT_SECRET }}
  run: npm run build
```

---

## 6. Emergency Rollback

If something breaks in production:

### A. Rollback Web App

1. Go to `https://github.com/admin-mmr/trailhead/deployments`
2. Find the last good deployment
3. Click **Reactivate**

Or revert the last commit:

```bash
git revert HEAD
git push origin main
```

### B. Rollback GAS

In Google Apps Script Editor:

1. **Project settings → Deployments**
2. Find the previous version
3. Click the three-dot menu → **Manage versions**
4. Select the stable version
5. Create a new deployment from that version

### C. Rollback Database

Restore from backup:

```bash
mysql -h mmr-mysql.mysql.database.azure.com \
      -u mmradmin \
      -p mmrdb < backup_YYYYMMDD.sql
```

---

## Monitoring & Logs

### A. GitHub Actions Logs

```
github.com/admin-mmr/trailhead/actions
  → Click a workflow run
  → View the detailed logs
```

### B. Azure Application Insights

In Azure Portal:

1. Static Web App → **Monitoring → Logs**
2. Query examples:

```kusto
// Show recent errors
requests
| where resultCode >= 400
| order by timestamp desc
| take 20
```

### C. MySQL Slow Queries

```sql
-- Show slow queries (over 1 second)
SELECT * FROM mysql.slow_log LIMIT 10;
```

---

## Troubleshooting Deployments

| Problem | Diagnosis | Fix |
|---------|-----------|-----|
| GitHub Actions fails build | Check logs in Actions tab | Run `npm run verify` locally first |
| Azure deployment rejected | Check secret name matches workflow | Verify `AZURE_STATIC_WEB_APPS_API_TOKEN_*` exists in GitHub Secrets |
| `DATABASE_URL` undefined | Env var not set in Azure | Add to Azure Static Web App configuration |
| GAS push fails | Clasp version mismatch | `npm install` in gas/membership/ |
| Photo pipeline timeout | Too many API calls | Add rate limiting in photo-manager code |
| MySQL connection fails | Network/IP issue | Check Azure firewall allows your IP |

---

## Deployment Checklist Before Going Live

Before deploying to production:

- [ ] All tests pass locally (`npm run verify`)
- [ ] Database migration tested on a backup first
- [ ] GitHub Actions workflow has run successfully
- [ ] GAS changes pushed via `npm run push`
- [ ] Environment variables configured in Azure Portal
- [ ] Backup of database created
- [ ] Team notified of deployment
- [ ] Monitoring setup (Application Insights, error logging)

---

## Support

For deployment issues:
1. Check the **Troubleshooting** section above
2. Look at GitHub Actions logs
3. Check Azure Portal for errors
4. See [`MONOREPO.md`](MONOREPO.md) for architecture overview

---

## License

MIT — see [`LICENSE`](LICENSE)
