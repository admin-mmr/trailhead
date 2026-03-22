# 🧪 Azure Staging Environments & Testing Guide

**Purpose**: How to set up multiple testing environments in Azure Static Web Apps
**Status**: Ready to implement
**Date**: March 22, 2026

---

## Your Current Setup

| Environment | URL | Branch | Auto-Deploy | Status |
|-------------|-----|--------|-------------|--------|
| **Production** | `https://www.mmrunners.org` | `main` | ✅ Yes | Live |
| **Azure Default** | `https://orange-tree-0d70d110f.4.azurestaticapps.net` | `main` | ✅ Yes | Always available |
| **Staging** | ⏳ Not yet set up | `develop` | ⏳ Optional | — |
| **PR Previews** | `https://preview-*.azurestaticapps.net` | PR branches | ⏳ Optional | — |

---

## Option 1: Azure Staging Slots (Recommended) ⭐

Azure Static Web Apps has built-in **staging environments** for each branch/PR.

### How It Works

```
When you push to a branch:
├─ main branch           → https://www.mmrunners.org (Production)
├─ develop branch        → https://preview-[hash].azurestaticapps.net (Staging)
├─ feature/xyz branch    → https://preview-feature-xyz-[hash].azurestaticapps.net (Feature preview)
└─ Pull Requests         → Auto-created staging slots
```

### Setup (5 minutes)

**Step 1: Update GitHub Actions Workflow**

Edit `.github/workflows/azure-static-web-apps-prod.yml`:

```yaml
on:
  push:
    branches:
      - main
      - develop                    # ← Add this line
  pull_request:
    types: [opened, reopened, closed]  # ← Add this line
```

**Step 2: Update Azure Deployment Step**

```yaml
- name: Build And Deploy
  uses: Azure/static-web-apps-deploy@v1
  with:
    azure_static_web_apps_api_token: ${{ secrets.AZURE_STATIC_WEB_APPS_API_TOKEN_ORANGE_TREE_0D70D110F }}
    action: 'upload'                # ← Add 'upload' for production + staging
    app_location: 'web-apps/mmr-webapp'
    output_location: 'out'          # ← Your Next.js build output
```

**Step 3: Configure Route Rules** (Optional - for environment-specific logic)

Create `staticwebapp.config.json` in root of `web-apps/mmr-webapp/`:

```json
{
  "navigationFallback": {
    "rewrite": "404.html",
    "exclude": ["/images/*", "/css/*", "/*.json"]
  },
  "routes": [
    {
      "route": "/api/*",
      "methods": ["GET", "POST", "PUT", "DELETE"],
      "allowAnonymous": false
    },
    {
      "route": "/*",
      "serve": "/index.html",
      "statusCode": 200
    }
  ],
  "environmentVariables": {
    "NODE_ENV": "production"
  }
}
```

### Using Staging Slots

**For a Pull Request:**
1. Create a PR from `feature/my-feature` → `main`
2. GitHub automatically creates a staging slot
3. Azure comments on the PR with the preview URL:
   ```
   ✅ Staging environment ready
   Preview: https://preview-feature-my-feature-abc123.azurestaticapps.net
   ```
4. Team can review the changes before merging
5. PR closes → staging slot auto-deleted

**For a Development Branch:**
1. Push to `develop` branch
2. GitHub triggers deployment to staging
3. URL: `https://preview-develop-[hash].azurestaticapps.net`
4. Persists until you merge or delete the branch

**Access a Staging Slot:**
```bash
# Option 1: Click the link in PR comment
# Option 2: Manual URL construction
https://preview-develop-abc123def456.azurestaticapps.net

# Option 3: From Azure Portal
# Go to "Environments" in your Static Web App resource
```

---

## Option 2: Separate Azure Instances (Alternative)

If you want fully **separate production and staging instances**:

### Create Second Instance

**In Azure Portal:**
1. Go to Static Web Apps
2. Click **Create**
3. Name: `mmr-webapp-staging`
4. Resource group: `mmr-resources`
5. Region: East US 2 (same as prod)
6. GitHub repo: same repo
7. Build presets: Next.js
8. App location: `web-apps/mmr-webapp`
9. Output location: `out`

### Create Second GitHub Actions Workflow

Create `.github/workflows/azure-static-web-apps-staging.yml`:

```yaml
name: Azure Static Web Apps - Staging

on:
  push:
    branches:
      - develop
  pull_request:
    types: [opened, reopened, closed]
    branches:
      - develop

jobs:
  build_and_deploy_staging:
    if: github.event_name == 'push' || (github.event_name == 'pull_request' && github.event.action != 'closed')
    runs-on: ubuntu-latest
    name: Build and Deploy (Staging)
    steps:
      - uses: actions/checkout@v3
        with:
          submodules: true
      - name: Build And Deploy to Staging
        uses: Azure/static-web-apps-deploy@v1
        with:
          azure_static_web_apps_api_token: ${{ secrets.AZURE_STATIC_WEB_APPS_API_TOKEN_STAGING }}
          action: 'upload'
          app_location: 'web-apps/mmr-webapp'
          output_location: 'out'
          skip_app_build: false

  close_pull_request_job:
    if: github.event_name == 'pull_request' && github.event.action == 'closed'
    runs-on: ubuntu-latest
    name: Close Pull Request Job
    steps:
      - name: Close Pull Request
        uses: Azure/static-web-apps-deploy@v1
        with:
          azure_static_web_apps_api_token: ${{ secrets.AZURE_STATIC_WEB_APPS_API_TOKEN_STAGING }}
          action: 'close'
```

### Add Staging Secret to GitHub

1. Go to Azure Portal → `mmr-webapp-staging` → Manage deployment token
2. Copy the token
3. Go to GitHub → Settings → Secrets → Add: `AZURE_STATIC_WEB_APPS_API_TOKEN_STAGING`
4. Paste the token

### Result

| Branch | URL |
|--------|-----|
| `main` | `https://www.mmrunners.org` |
| `develop` | `https://mmr-webapp-staging.azurestaticapps.net` |

---

## Option 3: Simple Local Testing (No Azure Staging)

If you don't need a staging environment in Azure, just test locally:

```bash
cd web-apps/mmr-webapp

# Test build locally
npm run build

# Start production server locally
npm run start

# Visit: http://localhost:3000
```

Then when you're confident:
```bash
git push origin main  # Goes to production
```

---

## Comparison: Which Option to Choose?

| Feature | Staging Slots | Separate Instances | Local Testing |
|---------|---|---|---|
| **Cost** | ✅ Free (same instance) | ❌ Doubles Azure cost | ✅ Free |
| **Preview per PR** | ✅ Auto-created | ⚠️ Manual setup | ❌ No |
| **Persistent URL** | ❌ Changes per branch | ✅ Stable URL | ❌ No |
| **Setup time** | ✅ 5 minutes | ⏳ 20 minutes | ✅ 0 minutes |
| **Team collaboration** | ✅ Easy share preview links | ✅ Stable link | ❌ Sharing harder |
| **Environment separation** | ⚠️ Same database | ✅ Can use separate DBs | ✅ Local DB |
| **Complexity** | ✅ Simple | ❌ Complex | ✅ Simple |

**Recommendation**: Start with **Option 1 (Staging Slots)** — it's free, automatic, and great for PR reviews.

---

## Workflow: Staging + Production

### Example: Develop a Feature

```bash
# 1. Create feature branch
git checkout -b feature/new-dashboard
# → Staging available at: https://preview-feature-new-dashboard-[hash].azurestaticapps.net

# 2. Make changes, push
git add .
git commit -m "feat: new dashboard"
git push origin feature/new-dashboard
# → Auto-deployed to staging

# 3. Test on staging
# Open: https://preview-feature-new-dashboard-[hash].azurestaticapps.net
# ✅ Looks good

# 4. Create PR
# → GitHub comments with staging URL
# → Team reviews changes

# 5. Team approves, you merge
git checkout main
git pull origin main
git merge feature/new-dashboard
git push origin main
# → Auto-deployed to production: https://www.mmrunners.org
# → Staging slot deleted (PR closed)

# 6. Delete branch
git branch -d feature/new-dashboard
```

---

## Troubleshooting Staging

### Staging Slot Not Created

**Problem**: Pushed to branch but no preview URL appeared

**Solutions**:
1. Check GitHub Actions workflow runs (Actions tab)
2. Verify `.github/workflows/azure-static-web-apps-*.yml` includes your branch
3. Confirm `AZURE_STATIC_WEB_APPS_API_TOKEN_*` secret is set in GitHub
4. Wait 2-3 minutes (builds can be slow)

### Staging URL Shows Old Code

**Problem**: Cached content showing old version

**Solutions**:
1. Hard refresh: `Ctrl+Shift+R` (or `Cmd+Shift+R` on Mac)
2. Clear browser cache
3. Check GitHub Actions logs to confirm new build ran
4. Wait for deployment to complete

### Staging Database Connection Issues

**Problem**: Staging connects to wrong database

**Solutions**:
- **If using same database as production**: Normal — both environments share data
- **If you want separate DB**: Create separate Azure MySQL instance + use environment variables

Example in `web-apps/mmr-webapp/lib/db.ts`:
```typescript
const dbConfig = {
  host: process.env.MYSQL_HOST,
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database: process.env.MYSQL_DATABASE,
}
```

Then set environment variables per deployment in Azure Portal → Configuration.

---

## Using Environment Variables

### For Staging-Specific Configuration

In Azure Portal:

1. Go to `mmr-webapp` → Configuration
2. Add environment variables:
   ```
   NEXT_PUBLIC_API_URL = https://orange-tree-0d70d110f.4.azurestaticapps.net/api
   NEXT_PUBLIC_ENV = staging
   ```

3. In your Next.js code:
   ```typescript
   const apiUrl = process.env.NEXT_PUBLIC_API_URL
   const env = process.env.NEXT_PUBLIC_ENV  // 'staging' or 'production'
   ```

### For Different Databases

Create separate databases:
- `mmrdb` → Production
- `mmrdb_staging` → Staging

Then in Azure Configuration:
```
# Production slot
MYSQL_DATABASE = mmrdb
MYSQL_HOST = mmr-mysql-v4.mysql.database.azure.com

# Staging slot
MYSQL_DATABASE = mmrdb_staging
MYSQL_HOST = mmr-mysql-v4.mysql.database.azure.com  (same server, different DB)
```

---

## Monitoring Staging

### View Staging Logs

**In Azure Portal:**
1. Go to `mmr-webapp` → Environments
2. Click your staging environment name
3. View build logs and runtime logs

**In GitHub Actions:**
1. Go to Actions tab
2. Click the workflow run
3. View detailed logs per step

### Check Staging Health

```bash
# Staging default URL
curl -I https://orange-tree-0d70d110f.4.azurestaticapps.net

# Expected output:
# HTTP/2 200 OK
# content-type: text/html
```

---

## Best Practices

### 1. Always Use Staging Before Production
```
feature branch → staging (test) → main → production
```

### 2. Test Critical Flows in Staging
- [ ] Member login
- [ ] Payment submission
- [ ] Photo upload
- [ ] Database queries
- [ ] Email notifications

### 3. Clean Up Old Staging Branches
```bash
# Delete merged feature branches
git branch -d feature/old-feature
git push origin --delete feature/old-feature
```

### 4. Document Staging URLs in PR
In PR description:
```markdown
## Testing
Staging: https://preview-feature-xyz-abc123.azurestaticapps.net

### Test Cases
- [ ] Login works
- [ ] Dashboard loads
- [ ] Photos upload
```

### 5. Keep Staging Database Clean
If using separate staging DB, occasionally:
```sql
-- Reset staging data to test fresh
DELETE FROM payments;
DELETE FROM members WHERE created_at < DATE_SUB(NOW(), INTERVAL 7 DAY);
```

---

## Summary: Recommended Setup

For your MMR project, I recommend:

1. **Keep current production** (`main` → `https://www.mmrunners.org`)
2. **Implement staging slots** (develop + PRs → automatic preview URLs)
3. **No separate instance needed** (free staging is better)

**To implement**:
1. Update `.github/workflows/azure-static-web-apps-*.yml` to include `develop` branch
2. Push to `develop` to test
3. Create PRs to `main` for team review
4. Merge to `main` for production

**Cost**: Free (staging slots included with Static Web Apps)
**Time to setup**: ~5 minutes
**Benefit**: Team can review changes before production

---

## Next Steps

1. **Ready to implement?** Let me update your GitHub Actions workflow
2. **Want separate staging database?** I can add environment-specific MySQL setup
3. **Need email/other services in staging?** I can guide per-environment configuration

Which option would you like to go with?

---

**Reference**:
- [Azure Static Web Apps Staging Docs](https://learn.microsoft.com/en-us/azure/static-web-apps/review-publish-pull-requests)
- [GitHub Actions for Static Web Apps](https://github.com/Azure/static-web-apps-deploy)
- Your Azure Static Web App: `mmr-webapp` (resource group: `mmr-resources`)

---

*Created: March 22, 2026*
*Purpose: Guide for setting up testing/staging environments in Azure*
