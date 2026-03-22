# 🧪 MMR Staging Setup: Azure Staging Slots (Option 1)

**Status**: Ready to implement
**Setup Time**: 5 minutes
**Cost**: Free (included with Azure Static Web Apps)

---

## Your Environment Architecture

```
GitHub Branches         Azure Deployment        Public URL
───────────────────     ────────────────────    ────────────────────────────────────

main                →   Production Slot      →  https://orange-tree-0d70d110f.
                        (live)                   4.azurestaticapps.net
                                                 ✅ PRODUCTION

develop             →   Staging Slot         →  https://preview-develop-[hash].
                        (testing)                azurestaticapps.net
                                                 🧪 STAGING

feature/xyz         →   Preview Slot         →  https://preview-feature-xyz-[hash].
                        (auto-created)           azurestaticapps.net
                                                 📋 FEATURE PREVIEW

PR #42              →   PR Slot              →  https://preview-[pr-number]-[hash].
                        (auto-created)           azurestaticapps.net
                                                 🔍 CODE REVIEW
```

---

## Setup (5 Steps)

### Step 1: Update GitHub Actions Workflow

Edit `.github/workflows/azure-static-web-apps-prod.yml`:

Find the `on:` section and update it:

```yaml
on:
  push:
    branches:
      - main
      - develop              # ← ADD THIS LINE
  pull_request:
    types: [opened, reopened, closed, synchronize]  # ← ADD THIS LINE (for PR previews)
```

### Step 2: Configure staticwebapp.config.json

Create `web-apps/mmr-webapp/staticwebapp.config.json`:

```json
{
  "navigationFallback": {
    "rewrite": "/index.html",
    "exclude": ["/api/*", "/images/*", "/css/*", "/*.json", "/*.ico"]
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
  "mimeTypes": {
    ".json": "application/json",
    ".wasm": "application/wasm"
  }
}
```

### Step 3: Commit & Push

```bash
cd trailhead
git add .github/workflows/azure-static-web-apps-prod.yml web-apps/mmr-webapp/staticwebapp.config.json
git commit -m "feat: enable azure staging slots for develop branch and PRs"
git push origin main
```

### Step 4: Create develop Branch

```bash
# Create and push develop branch
git checkout -b develop
git push -u origin develop
```

### Step 5: Verify in Azure Portal

1. Go to [portal.azure.com](https://portal.azure.com)
2. Find `mmr-webapp` in `mmr-resources` resource group
3. Click **Environments** (left sidebar)
4. Should see:
   - Production (main branch)
   - Preview (develop branch) — if you've pushed to it
   - Preview (PR branches) — when you create a PR

---

## How to Use

### Development Workflow

```bash
# 1. Create feature branch from develop
git checkout develop
git pull origin develop
git checkout -b feature/new-dashboard

# 2. Make changes
# ... edit files ...

# 3. Push to feature branch (auto-creates preview)
git push -u origin feature/new-dashboard
# ✅ Azure auto-creates: https://preview-feature-new-dashboard-[hash].azurestaticapps.net

# 4. Open Pull Request
# Go to GitHub → Create PR: feature/new-dashboard → develop
# 📋 Azure comments with preview URL

# 5. Team reviews on preview URL
# Share: https://preview-feature-new-dashboard-[hash].azurestaticapps.net

# 6. Merge to develop (if approved)
git checkout develop
git pull origin develop
git merge feature/new-dashboard
git push origin develop
# 🧪 Staging auto-updates: https://preview-develop-[hash].azurestaticapps.net

# 7. Test on staging
# Visit: https://preview-develop-[hash].azurestaticapps.net

# 8. When ready for production, merge develop → main
git checkout main
git pull origin main
git merge develop
git push origin main
# ✅ Production auto-updates: https://orange-tree-0d70d110f.4.azurestaticapps.net
```

### Quick Reference: URLs by Environment

| Environment | How to Access | URL Pattern |
|-------------|---------------|------------|
| **Production** | Visit main branch | `https://orange-tree-0d70d110f.4.azurestaticapps.net` |
| **Staging** | Visit develop branch | `https://preview-develop-[hash].azurestaticapps.net` |
| **Feature Preview** | Create feature branch | `https://preview-feature-xyz-[hash].azurestaticapps.net` |
| **PR Preview** | Open a Pull Request | Auto-commented by Azure |

---

## Common Tasks

### Find Your Staging URL

**After pushing to `develop`:**

```bash
# Wait 2-3 minutes for build
# Option 1: Check Azure Portal
# Settings → Environments → preview (develop)

# Option 2: Check GitHub Actions
# Go to Actions tab → Latest run → View URL in logs
```

### View Staging Logs

**In Azure Portal:**
1. `mmr-webapp` → Environments
2. Click the staging environment
3. View build logs and runtime logs

**In GitHub Actions:**
1. Actions tab → Latest workflow run
2. Expand "Build and Deploy" step
3. Scroll to see deployment logs

### Test on Staging Before Production

```bash
# Staging URL (develop branch)
https://preview-develop-abc123def456.azurestaticapps.net

# Checklist:
- [ ] Login works with test user
- [ ] Dashboard loads correctly
- [ ] Payment form validates
- [ ] Photos upload properly
- [ ] Database queries work
- [ ] No console errors (check browser DevTools)
```

### Rollback from Production

```bash
# If production has a problem:

# Option 1: Revert last commit
git revert <last-commit-hash>
git push origin main
# Azure auto-deploys reverted code

# Option 2: Cherry-pick from develop
git checkout main
git cherry-pick <known-good-commit>
git push origin main
```

---

## Troubleshooting

### Staging Slot Not Created

**Problem**: Pushed to `develop` but no preview URL

**Check**:
1. GitHub Actions workflow ran? (Actions tab)
2. Workflow file includes `develop` branch? (Check YAML)
3. Secret `AZURE_STATIC_WEB_APPS_API_TOKEN_ORANGE_TREE_0D70D110F` exists in GitHub?
4. Build succeeded? (Check GitHub Actions logs)

**Fix**:
```bash
# Re-trigger by pushing again
git commit --allow-empty -m "trigger: rebuild staging"
git push origin develop
```

### Staging Shows Old Code

**Problem**: Staging URL showing previous version

**Solutions**:
1. Hard refresh: `Ctrl+Shift+R` (or `Cmd+Shift+R` on Mac)
2. Wait 3-5 minutes (builds can be slow)
3. Check GitHub Actions to see if new build is running
4. Clear browser cache if still stale

### PR Preview Not Working

**Problem**: Created PR but no preview URL in comments

**Check**:
1. GitHub Actions has permission to comment on PRs?
2. Workflow includes `pull_request` event?
3. Check Actions logs for errors

**Fix**:
```bash
# Close and reopen PR to retry
# Or push a new commit to the feature branch
git commit --allow-empty -m "trigger: create preview"
git push
```

---

## Branch Strategy

### Recommended Git Flow

```
main (production)
  ↑
  ├← Merge only verified code from develop
  |
develop (staging/testing)
  ↑
  ├← Merge feature branches after PR review
  |
feature/new-dashboard (feature preview)
  ↑
  └← Your work happens here
```

### Branch Naming

```
feature/dashboard           # New feature
bugfix/payment-validation   # Bug fix
chore/update-dependencies   # Maintenance
docs/deployment-guide       # Documentation
```

---

## Environment Variables

### Same Database for All Environments

Currently, all environments (production, staging, feature previews) connect to the **same MySQL database** (`mmrdb`).

```
Production:  orange-tree-0d70d110f.4.azurestaticapps.net → mmrdb
Staging:     preview-develop-*.azurestaticapps.net      → mmrdb (same)
Previews:    preview-feature-*.azurestaticapps.net      → mmrdb (same)
```

This is **intentional** — you want to test against real data before production.

### If You Want Separate Databases Later

Create separate MySQL databases:
```sql
CREATE DATABASE mmrdb_staging;
CREATE DATABASE mmrdb_preview;
```

Then set environment variables in Azure Portal per environment.

---

## Cost & Performance

| Metric | Details |
|--------|---------|
| **Cost** | Free (included with Static Web Apps) |
| **Build time** | 2-3 minutes per deployment |
| **Storage** | Unlimited staging slots |
| **Bandwidth** | Included in Azure tier |
| **Auto-cleanup** | Staging slots auto-deleted when branch deleted |

---

## Monitoring & Alerts

### Monitor Deployments

Check GitHub Actions:
```
https://github.com/admin-mmr/trailhead/actions
```

Each branch/PR shows:
- Build status (✅ or ❌)
- Build duration
- Deployment URL (if successful)

### Set Alerts (Optional)

In Azure Portal → `mmr-webapp` → Alerts, you can set:
- Build failures
- High latency
- Error rate spikes

---

## Summary

✅ **What you get:**
- Production at: `https://orange-tree-0d70d110f.4.azurestaticapps.net`
- Staging at: `https://preview-develop-[hash].azurestaticapps.net`
- Auto-previews per PR
- Zero cost
- 5-minute setup

🔄 **Your workflow:**
1. Create feature branch
2. Push → auto-preview created
3. Team reviews
4. Merge to develop → staging updates
5. Test on staging
6. Merge to main → production updates
7. Feature branch deleted → preview auto-deleted

📊 **Environment Status**

| Environment | URL | Branch | Status |
|-----------|-----|--------|--------|
| Production | `orange-tree-0d70d110f.4.azurestaticapps.net` | `main` | ✅ Live |
| Staging | `preview-develop-*.azurestaticapps.net` | `develop` | 🟡 Not yet pushed |
| Previews | `preview-*.azurestaticapps.net` | PR/feature | 🟡 On demand |

---

## Next Steps

1. ✅ Update GitHub Actions workflow (Step 1 above)
2. ✅ Create `staticwebapp.config.json` (Step 2)
3. ✅ Commit and push (Step 3)
4. ✅ Create `develop` branch (Step 4)
5. ✅ Verify in Azure Portal (Step 5)
6. Push to `develop` and test staging URL
7. Create first feature branch and PR
8. Share preview URL with team

---

**Setup Date**: March 22, 2026
**Reference**: Azure Static Web Apps Staging Environments
**Questions?** Check `DEPLOYMENT.md` or `AZURE_RESOURCES.md`
