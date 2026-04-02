# GitHub Secrets Configuration for GAS Email

## Required GitHub Secret

**Location:** GitHub repo → Settings → Secrets and variables → Actions → Repository secrets

### Add This Secret:

| Secret Name | Value |
|---|---|
| `GAS_WEBHOOK_URL` | `https://script.google.com/macros/s/AKfycbxjTf60ws8K-kcILGrc6YUZH9KSfAkf4hr_wiwzOHZCkVwOkCQ5tKg6gEVIfGFkc--23A/exec` |

**This secret is used by:**
- ✅ GitHub Actions workflows (cron jobs, batch notifications)
- ✅ Azure App Service (mmr-admin via environment variable)
- ✅ Next.js webapp (via Azure App Service config)

---

## No Longer Needed (Can Delete)

If migrating away from SMTP:

- `MAIL_SERVER` ❌
- `MAIL_PORT` ❌
- `MAIL_USERNAME` ❌
- `MAIL_PASSWORD` ❌

These can be safely deleted once all workflows are updated to use GAS webhook.

---

## Environment Variable Naming

To maintain backward compatibility, all systems accept:

### Primary (Recommended):
```bash
GAS_WEBHOOK_URL=https://script.google.com/macros/s/AKfycbxjTf60ws8K-kcILGrc6YUZH9KSfAkf4hr_wiwzOHZCkVwOkCQ5tKg6gEVIfGFkc--23A/exec
```

### Legacy Fallback (mmr-admin only):
```bash
SHEETS_WEBHOOK_URL=https://script.google.com/macros/s/AKfycbxjTf60ws8K-kcILGrc6YUZH9KSfAkf4hr_wiwzOHZCkVwOkCQ5tKg6gEVIfGFkc--23A/exec
```

---

## Azure App Service Configuration

For mmr-admin running on Azure App Service:

**Path:** Azure Portal → App Service → Configuration → Application settings

### Add:
```
GAS_WEBHOOK_URL = https://script.google.com/macros/s/AKfycbxjTf60ws8K-kcILGrc6YUZH9KSfAkf4hr_wiwzOHZCkVwOkCQ5tKg6gEVIfGFkc--23A/exec
```

This can be hardcoded since it's the GAS webhook (not a secret).

---

## Next.js Webapp Configuration

For web-apps/mmr-webapp running on Azure App Service:

**Path:** Azure Portal → App Service → Configuration → Application settings

### Add:
```
GAS_WEBHOOK_URL = https://script.google.com/macros/s/AKfycbxjTf60ws8K-kcILGrc6YUZH9KSfAkf4hr_wiwzOHZCkVwOkCQ5tKg6gEVIfGFkc--23A/exec
```

**OR** use GitHub Secrets during deployment via CI/CD.

---

## Verification Checklist

- [ ] GAS_WEBHOOK_URL added to GitHub Secrets
- [ ] GAS_WEBHOOK_URL added to Azure App Service (mmr-admin)
- [ ] GAS_WEBHOOK_URL added to Azure App Service (Next.js webapp)
- [ ] GitHub Actions workflows updated (see CONVERT_WORKFLOWS_TO_GAS.md)
- [ ] mmr-admin webhook_client.py tested
- [ ] Next.js email routes tested
- [ ] GAS webhook receiving and sending emails verified
- [ ] SMTP secrets removed from GitHub (optional, after testing)

---

*Configuration complete: 2026-04-02*
