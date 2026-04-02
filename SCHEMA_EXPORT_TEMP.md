# Temporary Schema Export Endpoint

## Why this exists
Port 3306 (MySQL) is blocked in your hotel. This endpoint allows you to export the schema from Azure Web App (which *can* reach MySQL internally).

## Prerequisites
The endpoint needs MySQL connection env vars set on Azure. These should already be in your **App Settings** if mmr-admin is deployed:
- `MYSQL_HOST` — e.g., `mmr-mysql-v4.mysql.database.azure.com`
- `MYSQL_USER` — e.g., `dbadmin`
- `MYSQL_PASSWORD` — your DB password
- `MYSQL_DATABASE` (optional) — defaults to `mmrdb`

**If they're missing:** Add them via Azure Portal → App Service → Settings → Environment variables (or Configuration tab).

## How to use

### 1. Deploy the updated code
```bash
# From repo root
git add mmr-admin/api_schema.py mmr-admin/app.py
git commit -m "temp: add schema export endpoint (for hotel network)"
git push
```

### 2. Trigger deployment
Deploy to Azure Web App as usual. Once live, the endpoint auto-loads.

### 3. Download the schema
```bash

curl https://mmr-nyrr-viewer-e9gugyf4gqc4gmgv.swedencentral-01.azurewebsites.net/api/export-schema > db/schema_snapshot.sql
```

The endpoint will:
- ✅ Try `mysqldump` if available (fast, local dev)
- ✅ Fall back to `mysql-connector-python` (works on Azure, no binary deps needed)

### 4. Commit the snapshot
```bash
git add db/schema_snapshot.sql
git commit -m "chore: update schema snapshot from Azure"
git push
```

### 5. Clean up (IMPORTANT)
Once you're done and back on a normal network, **remove the temporary endpoint**:

```bash
# Delete the file
rm mmr-admin/api_schema.py

# Edit mmr-admin/app.py and remove these lines:
#   from api_schema import schema_bp
#   app.register_blueprint(schema_bp)

# Delete this file
rm SCHEMA_EXPORT_TEMP.md

# Commit cleanup
git add mmr-admin/app.py
git commit -m "chore: remove temporary schema export endpoint"
git push
```

---

## Troubleshooting

**Error: `Missing MySQL env vars`**
- Check Azure App Settings contain `MYSQL_HOST`, `MYSQL_USER`, `MYSQL_PASSWORD`
- Restart the app after adding env vars

**Error: `MySQL connection failed`**
- Verify credentials are correct in App Settings
- Check Azure MySQL firewall allows App Service IP (should be auto-configured)

**Error: `Unexpected error`**
- Check Azure App Service logs: Portal → App Service → Log stream

---

## Security Notes
- ✅ Exports **schema only** (no actual data)
- ⚠️ Should be temporary; remove after use
- 🔐 If this endpoint is live in production, add auth (check `api_data.py` for patterns)
