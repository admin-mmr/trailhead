# Azure Resources Reference

Complete list of all Azure resources used by the MMR trailhead platform.

## Resource Names & Details

| Service | Resource Name | Type | Location | Purpose |
|---------|---------------|------|----------|---------|
| **MySQL Database** | `mmr-mysql-v4` | Azure Database for MySQL (flexible server) | Sweden Central | Primary database for members, payments, activity logs, sync metadata |
| **Static Web App** | `mmr-webapp` | Static Web App | East US 2 | Next.js member portal and API backend |
| **Storage Account** | `mmrunnersstorage` | Storage Account | East US | Blob storage for snapshots, photos, backups |
| **Communication Service** | `mmr-comm` | Communication Service | Global | Email sending (renewal reminders, notifications) |
| **Communication Service Domain** | `AzureManagedDomain (mmr/AzureManagedDomain)` | Email Communication Services Domain | Global | Email domain for Communication Service |
| **Email Service** | `mmr` | Email Communication Service | Global | Legacy email service |
| **Resource Group** | `mmr-resources` | Resource Group | — | Contains all MMR resources |

---

## Service Connection Details

### MySQL Database (`mmr-mysql-v4`)

```bash
Host:     mmr-mysql-v4.mysql.database.azure.com
Port:     3306
Database: mmrdb
User:     mmradmin
SSL:      Required
```

**Connection String (MySQL CLI):**
```bash
mysql -h mmr-mysql-v4.mysql.database.azure.com \
      -u mmradmin \
      -p mmrdb
```

**Connection String (Python):**
```python
mysql.connector.connect(
    host='mmr-mysql-v4.mysql.database.azure.com',
    user='mmradmin',
    password=os.environ['MYSQL_PASSWORD'],
    database='mmrdb',
    ssl_disabled=False
)
```

**Connection String (Node.js):**
```typescript
const pool = mysql.createPool({
  host: 'mmr-mysql-v4.mysql.database.azure.com',
  user: 'mmradmin',
  password: process.env.DATABASE_PASSWORD,
  database: 'mmrdb',
  ssl: 'Amazon',  // or 'Amazon' for Node MySQL
  connectionLimit: 10
})
```

### Static Web App (`mmr-webapp`)

```bash
Domain:           https://www.mmrunners.org
Default Domain:   https://orange-tree-0d70d110f.eastus2.azurestaticapps.net
App Location:     web-apps/mmr-webapp
Build Output:     .next
API Location:     —
```

**Deployment Token Secret (GitHub):**
```
AZURE_STATIC_WEB_APPS_API_TOKEN_ORANGE_TREE_0D70D110F
```

### Storage Account (`mmrunnersstorage`)

```bash
Account Name:     mmrunnersstorage
Primary Endpoint: https://mmrunnersstorage.blob.core.windows.net
Containers:
  - mmr-snapshots       (sync snapshots for Google Sheets)
  - mmr-photos          (member profile photos)
  - mmr-backups         (database backups)
  - mmr-payments        (payment screenshot storage)
```

**Access Connection String:**
```bash
DefaultEndpointsProtocol=https;
AccountName=mmrunnersstorage;
AccountKey=<KEY>;
EndpointSuffix=core.windows.net
```

### Communication Service (`mmr-comm`)

```bash
Service Name:     mmr-comm
Endpoint:         https://mmr-comm.communication.azure.com/
```

**Used for:**
- Sending membership renewal reminder emails
- Payment notifications
- Account status updates
- Admin notifications

---

## Environment Variables

Use these exact service names in your `.env.local` files:

### Web App (`web-apps/mmr-webapp/.env.local`)

```bash
# Database
DATABASE_URL=mysql://mmradmin:PASSWORD@mmr-mysql-v4.mysql.database.azure.com:3306/mmrdb?ssl=true

# Azure Storage (blob snapshots, photos)
AZURE_STORAGE_CONNECTION_STRING=DefaultEndpointsProtocol=https;AccountName=mmrunnersstorage;...

# Azure Communication Service (email)
AZURE_COMM_CONNECTION_STRING=endpoint=https://mmr-comm.communication.azure.com/;accesskey=...

# App
NEXT_PUBLIC_APP_URL=https://www.mmrunners.org
JWT_SECRET=<random-secret>
```

### Sync Job (`basecamp/ops/.env.local`)

```bash
# MySQL
MYSQL_HOST=mmr-mysql-v4.mysql.database.azure.com
MYSQL_USER=mmradmin
MYSQL_PASSWORD=<password>
MYSQL_DATABASE=mmrdb

# Google Cloud
GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json

# Google Sheets IDs (from URLs)
GOOGLE_SHEETS_MEMBERSHIP_ID=11SFvgApmDtEv4jz5bTYI9_zEhCFMQAXC4b2z_4s3ljk  # Membership Master sheet
GMAIL_SPREADSHEET_ID=<your-gmail-spreadsheet-id>                         # Payment emails sheet

# Azure Storage
AZURE_STORAGE_CONNECTION_STRING=DefaultEndpointsProtocol=https;AccountName=mmrunnersstorage;...
```

**How to find Google Sheets ID:**
1. Open the Google Sheet in browser
2. URL: `https://docs.google.com/spreadsheets/d/SHEET_ID_HERE/edit`
3. Copy the `SHEET_ID_HERE` part

---

## GitHub Actions Secrets

All these secrets must be configured in `https://github.com/admin-mmr/trailhead/settings/secrets/actions`:

| Secret | Source | Used By |
|--------|--------|---------|
| `AZURE_STATIC_WEB_APPS_API_TOKEN_ORANGE_TREE_0D70D110F` | Azure Portal → Static Web App → Manage deployment token | Web app deployment |
| `MYSQL_HOST` | `mmr-mysql-v4.mysql.database.azure.com` | Sync job |
| `MYSQL_USER` | `mmradmin` | Sync job |
| `MYSQL_PASSWORD` | Your MySQL password | Sync job |
| `MYSQL_DATABASE` | `mmrdb` | Sync job |
| `GOOGLE_SERVICE_ACCOUNT` | Google Cloud Console → Service Account JSON | Sync job (Google Drive/Sheets) |
| `GOOGLE_SHEETS_MEMBERSHIP_ID` | Google Sheets ID for "Membership Master" sheet | Sync job (sheets-to-mysql) |
| `GMAIL_SPREADSHEET_ID` | Google Sheets ID for payment emails/transactions sheet | GAS sync (email → sheets) |
| `AZURE_STORAGE_CONNECTION_STRING` | Azure Portal → mmrunnersstorage → Access keys | Sync job (blob storage) |

---

## Common Commands

### Connect to MySQL

```bash
# Local development (requires MySQL CLI installed)
mysql -h mmr-mysql-v4.mysql.database.azure.com \
      -u mmradmin \
      -p mmrdb

# Using Azure CLI (if you have access)
az mysql flexible-server connect \
  --resource-group mmr-resources \
  --server-name mmr-mysql-v4 \
  --admin-user mmradmin
```

### Upload to Blob Storage

```bash
# Using Azure CLI
az storage blob upload \
  --account-name mmrunnersstorage \
  --container-name mmr-snapshots \
  --name "sheets/Membership Master/2026-03-21T02:00:00Z-abc12345.json" \
  --file ./snapshot.json \
  --connection-string "DefaultEndpointsProtocol=..."
```

### Deploy Web App (Manual)

```bash
# Trigger GitHub Actions (automatic on push to main)
git push origin main

# Or manually via Azure CLI
az staticwebapp create \
  --name mmr-webapp \
  --resource-group mmr-resources \
  --source https://github.com/admin-mmr/trailhead \
  --branch main \
  --location eastus2
```

### Apply Database Migration

```bash
mysql -h mmr-mysql-v4.mysql.database.azure.com \
      -u mmradmin \
      -p mmrdb < basecamp/migrations/0001_sync_metadata.sql
```

---

## Security & Access

### IP Allowlisting

MySQL (`mmr-mysql-v4`) requires your IP address to be allowlisted:

1. Go to Azure Portal → `mmr-mysql-v4` → **Networking**
2. Add your IP address (or `0.0.0.0` for open access — not recommended)
3. Click **Save**

### Firewall Rules

- Static Web App (`mmr-webapp`) → publicly accessible
- MySQL (`mmr-mysql-v4`) → restricted to allowlisted IPs
- Storage Account (`mmrunnersstorage`) → private with shared access signatures (SAS)
- Communication Service (`mmr-comm`) → access key required

---

## Monitoring & Diagnostics

### View Web App Logs

```bash
# GitHub Actions
https://github.com/admin-mmr/trailhead/actions

# Azure Portal
Portal → mmr-webapp → Logs
```

### View MySQL Logs

```bash
# Azure Portal
Portal → mmr-mysql-v4 → Server logs

# Or query directly
mysql> SELECT * FROM mysql.general_log LIMIT 10;
```

### View Blob Storage

```bash
# Azure Portal
Portal → mmrunnersstorage → Containers → [container-name]

# Or use Azure Storage Explorer
# https://azure.microsoft.com/en-us/products/storage/storage-explorer/
```

---

## Costs & Quotas

| Service | Tier | Estimated Cost |
|---------|------|---|
| MySQL (`mmr-mysql-v4`) | Flexible Server Standard | ~$100/month |
| Static Web App (`mmr-webapp`) | Standard (free tier available) | $0-50/month |
| Storage Account (`mmrunnersstorage`) | Standard LRS | $0.02-0.10 per GB |
| Communication Service (`mmr-comm`) | Pay-as-you-go email | ~$0.0001/email |

---

## Related Documentation

- [`DEPLOYMENT.md`](DEPLOYMENT.md) — How to deploy using these resources
- [`MONOREPO.md`](MONOREPO.md) — Architecture overview
- [`PROJECT_PLAN.md`](PROJECT_PLAN.md) — Upcoming features and infrastructure changes

---

## Last Updated

2026-03-21 (from Azure Portal screenshot)
