# Azure Infrastructure Reference

**Last updated**: March 2026
**Resource group**: `mmr-resources`

---

## Resources Overview

| Service | Resource Name | Type | Location | Purpose |
|---------|---------------|------|----------|---------|
| MySQL | `mmr-mysql-v4` | Flexible Server | Sweden Central | Primary DB |
| Web App | `mmr-webapp` | Static Web App | East US 2 | Next.js portal + API |
| Storage | `mmrunnersstorage` | Storage Account | East US | Blobs: snapshots, photos, backups |
| Email | `mmr-comm` | Communication Service | Global | Outbound email (renewal reminders, notifications) |

---

## Connection Details

### MySQL (`mmr-mysql-v4`)

```
Host:     mmr-mysql-v4.mysql.database.azure.com
Port:     3306
Database: mmrdb
User:     mmradmin
SSL:      Required
```

Quick alias:
```bash
mysql-mmr                          # interactive shell
mysql-mmr -e "SELECT COUNT(*) FROM members;"
mysql-mmr < path/to/migration.sql
```

Manual:
```bash
mysql -h mmr-mysql-v4.mysql.database.azure.com -u mmradmin -p --ssl-mode=REQUIRED mmrdb
```

Node.js / Python connection strings → see `DOCUMENTATION_INDEX.md` or `basecamp/.env.local.example`.

### Static Web App (`mmr-webapp`)

```
Production URL:  https://www.mmrunners.org
Azure default:   https://orange-tree-0d70d110f.4.azurestaticapps.net
App Location:    web-apps/mmr-webapp
Build Output:    .next
Deploy Secret:   AZURE_STATIC_WEB_APPS_API_TOKEN_ORANGE_TREE_0D70D110F
```

### Storage Account (`mmrunnersstorage`)

```
Primary endpoint: https://mmrunnersstorage.blob.core.windows.net
Containers:
  mmr-snapshots    ← sync snapshots (JSON from Google Sheets sync)
  mmr-photos       ← member profile photos
  mmr-backups      ← database backups
  mmr-payments     ← payment screenshot storage
```

Connection string format:
```
DefaultEndpointsProtocol=https;AccountName=mmrunnersstorage;AccountKey=<KEY>;EndpointSuffix=core.windows.net
```

### Communication Service (`mmr-comm`)

```
Endpoint: https://mmr-comm.communication.azure.com/
```

Used for: membership renewal reminders, payment notifications, account status updates.

---

## Firewall / Access

**MySQL** restricts by IP. Two options:

- Development: Azure Portal → `mmr-mysql-v4` → Networking → add your IP
- GitHub Actions: Azure Portal → `mmr-mysql-v4` → Connection security → **"Allow access to Azure services" = ON**

If the sync works locally but fails in GitHub Actions, this is almost always the cause.

---

## Environment Variables

### Web App (`web-apps/mmr-webapp/.env.local`)
```bash
DATABASE_URL=mysql://mmradmin:PASSWORD@mmr-mysql-v4.mysql.database.azure.com:3306/mmrdb?ssl=true
AZURE_STORAGE_CONNECTION_STRING=DefaultEndpointsProtocol=https;AccountName=mmrunnersstorage;...
AZURE_COMM_CONNECTION_STRING=endpoint=https://mmr-comm.communication.azure.com/;accesskey=...
NEXT_PUBLIC_APP_URL=https://www.mmrunners.org
JWT_SECRET=<random-secret>
```

### Sync Job (`basecamp/.env.local`)
```bash
MYSQL_HOST=mmr-mysql-v4.mysql.database.azure.com
MYSQL_USER=mmradmin
MYSQL_PASSWORD=<password>
MYSQL_DATABASE=mmrdb
GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json
GOOGLE_SHEETS_MEMBERSHIP_ID=11SFvgApmDtEv4jz5bTYI9_zEhCFMQAXC4b2z_4s3ljk
GMAIL_SPREADSHEET_ID=<gmail-sheet-id>
AZURE_STORAGE_CONNECTION_STRING=DefaultEndpointsProtocol=https;...
```

---

## Apply a Database Migration

```bash
mysql-mmr < basecamp/migrations/<migration-file>.sql
# or
mysql -h mmr-mysql-v4.mysql.database.azure.com -u mmradmin -p mmrdb < <file>.sql
```

---

## Staging Environments

### Current environment status

| Environment | URL | Branch | Status |
|-------------|-----|--------|--------|
| Production | `https://www.mmrunners.org` | `main` | ✅ Live |
| Azure default | `https://orange-tree-0d70d110f.4.azurestaticapps.net` | `main` | ✅ Always available |
| Staging | not yet configured | `develop` | ⏳ Optional |
| PR Previews | `https://preview-*.azurestaticapps.net` | PR branches | ⏳ Optional |

### Setting up staging slots (5 minutes, free)

Azure Static Web Apps creates a staging slot automatically for each branch/PR.

**Step 1**: Edit `.github/workflows/azure-static-web-apps-prod.yml` — add `develop` branch and PR triggers:
```yaml
on:
  push:
    branches:
      - main
      - develop                                          # ← add
  pull_request:
    types: [opened, reopened, closed, synchronize]       # ← add
```

**Step 2**: Create `web-apps/mmr-webapp/staticwebapp.config.json`:
```json
{
  "navigationFallback": {
    "rewrite": "/index.html",
    "exclude": ["/api/*", "/images/*", "/*.json", "/*.ico"]
  },
  "routes": [
    { "route": "/api/*", "methods": ["GET","POST","PUT","DELETE"], "allowAnonymous": false },
    { "route": "/*", "serve": "/index.html", "statusCode": 200 }
  ]
}
```

**Step 3**: Commit and push both files.

**Step 4**: Create and push `develop` branch:
```bash
git checkout -b develop
git push -u origin develop
```

Once active, slot URLs follow this pattern:
```
main branch    → https://orange-tree-0d70d110f.4.azurestaticapps.net (production)
develop branch → https://preview-develop-[hash].azurestaticapps.net
PR #42         → https://preview-42-[hash].azurestaticapps.net (auto-created, auto-deleted on close)
```

Azure comments on each PR with the preview URL automatically.

---

## Cost Reference

| Service | Tier | Est. Monthly |
|---------|------|-------------|
| MySQL `mmr-mysql-v4` | Flexible Server Standard | ~$100 |
| Static Web App `mmr-webapp` | Standard | $0–50 |
| Storage `mmrunnersstorage` | Standard LRS | $0.02–0.10/GB |
| Communication Service `mmr-comm` | Pay-as-you-go | ~$0.0001/email |

---

*See also: `DEPLOYMENT.md` · `docs/GITHUB_ACTIONS.md` · `docs/TROUBLESHOOTING.md`*
