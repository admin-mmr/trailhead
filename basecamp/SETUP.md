# Basecamp Local Setup Guide

How to set up your local environment to run basecamp Python scripts (sync jobs, data utilities, etc.).

## Quick Start (5 minutes)

### Option 1: Python venv (Recommended)

```bash
# Navigate to basecamp directory
cd basecamp

# Create virtual environment
python3 -m venv .venv

# Activate it
source .venv/bin/activate  # macOS/Linux
# or
.venv\Scripts\activate     # Windows

# Install dependencies
pip install -r requirements.txt

# Verify installation
python3 -c "import mysql.connector; print('✓ mysql.connector available')"
```

### Option 2: Global Python (Simple)

```bash
# Install dependencies globally
pip install -r basecamp/requirements.txt

# Verify
python3 -c "import mysql.connector; print('✓ mysql.connector available')"
```

---

## Running Sync Scripts

Once dependencies are installed, you can run sync jobs:

### Membership Master Sync (Google Sheets → MySQL)

```bash
# Make sure you're in the right directory and venv is activated
cd trailhead
source basecamp/.venv/bin/activate

# Set environment variables
export GOOGLE_SHEETS_MEMBERSHIP_ID="11SFvgApmDtEv4jz5bTYI9_zEhCFMQAXC4b2z_4s3ljk"
export GOOGLE_APPLICATION_CREDENTIALS="$HOME/.config/gcloud/service-account.json"

# Test with dry-run (no changes)
python3 basecamp/ops/sync_sheets_to_mysql.py \
  --sheet "Membership Master" \
  --spreadsheet-id "$GOOGLE_SHEETS_MEMBERSHIP_ID" \
  --dry-run

# Run actual sync
python3 basecamp/ops/sync_sheets_to_mysql.py \
  --sheet "Membership Master" \
  --spreadsheet-id "$GOOGLE_SHEETS_MEMBERSHIP_ID"
```

---

## Environment Variables

Create a `.env` file in `basecamp/` with these values:

```bash
# MySQL (for local testing against production DB)
MYSQL_HOST=mmr-mysql-v4.mysql.database.azure.com
MYSQL_USER=mmradmin
MYSQL_PASSWORD=<your-password>
MYSQL_DATABASE=mmrdb

# Google Cloud
GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json

# Google Sheets
GOOGLE_SHEETS_MEMBERSHIP_ID=11SFvgApmDtEv4jz5bTYI9_zEhCFMQAXC4b2z_4s3ljk
GMAIL_SPREADSHEET_ID=<your-gmail-sheet-id>

# Azure Storage
AZURE_STORAGE_CONNECTION_STRING=DefaultEndpointsProtocol=https;AccountName=mmrunnersstorage;...
```

Load with:
```bash
source basecamp/.env
```

---

## Dependencies

Current `requirements.txt` includes:

- **Google Cloud SDK**
  - `google-cloud-drive` — Google Drive API
  - `google-cloud-sheets` — Google Sheets API
  - `google-auth` — Authentication
  - `google-api-python-client` — Generic Google APIs

- **Azure**
  - `azure-storage-blob` — Azure Blob Storage
  - `azure-identity` — Azure authentication

- **Database**
  - `mysql-connector-python` — MySQL client

- **Utilities**
  - `python-dotenv` — .env file support
  - `requests` — HTTP client

### Adding New Dependencies

1. Add to `requirements.txt`
2. Install: `pip install <package>`
3. Commit: `git add requirements.txt && git commit -m "chore: add X dependency"`

---

## Troubleshooting

### "ModuleNotFoundError: No module named 'mysql'"

You haven't activated the venv or installed requirements:

```bash
# Make sure venv is activated
source basecamp/.venv/bin/activate

# Reinstall
pip install -r basecamp/requirements.txt

# Test
python3 -c "import mysql.connector; print('OK')"
```

### "ModuleNotFoundError: No module named 'google.cloud'"

Same fix — ensure venv is activated and requirements are installed.

### "Connection refused" when connecting to MySQL

- Check your IP is allowlisted in Azure MySQL (`mmr-mysql-v4` → Networking)
- Verify `MYSQL_PASSWORD` is correct
- Test connection:
  ```bash
  mysql -h mmr-mysql-v4.mysql.database.azure.com \
        -u mmradmin \
        -p mmrdb
  ```

### "Invalid grant" from Google API

- Service account JSON might be expired or invalid
- Download fresh credentials from Google Cloud Console
- Ensure `GOOGLE_APPLICATION_CREDENTIALS` points to correct file

---

## Testing the Sync

### 1. Dry-run (detect changes, no sync)

```bash
python3 basecamp/ops/sync_sheets_to_mysql.py \
  --sheet "Membership Master" \
  --spreadsheet-id "$GOOGLE_SHEETS_MEMBERSHIP_ID" \
  --dry-run
```

Expected output:
```
INFO - Starting sync for Membership Master
INFO - Created snapshot: abc12345, 42 rows
INFO - Detected changes: 2 added, 1 modified, 0 deleted
INFO - DRY RUN: Not syncing changes
```

### 2. Check what would be synced

Look at console output and verify it matches what you expect.

### 3. Run actual sync (without --dry-run)

```bash
python3 basecamp/ops/sync_sheets_to_mysql.py \
  --sheet "Membership Master" \
  --spreadsheet-id "$GOOGLE_SHEETS_MEMBERSHIP_ID"
```

### 4. Verify in MySQL

```bash
# Check sync metadata
mysql -h mmr-mysql-v4.mysql.database.azure.com -u mmradmin -p mmrdb
mysql> SELECT * FROM sync_metadata;
mysql> SELECT * FROM sync_snapshots ORDER BY created_at DESC LIMIT 5;
mysql> SELECT COUNT(*) FROM members;
```

---

## Next Steps

- See [`../DEPLOYMENT.md`](../DEPLOYMENT.md) for how to set up GitHub Actions automation
- See [`../PROJECT_PLAN.md`](../PROJECT_PLAN.md) for Phase 2 (MySQL → Google Sheets)

---

## FAQ

**Q: Can I run the sync without activating venv?**
A: No, you need the dependencies installed. Either activate venv or install globally with `pip install -r basecamp/requirements.txt`.

**Q: Do I need Google Cloud credentials to run the sync?**
A: Yes, you need a service account JSON file with Drive and Sheets API permissions. Download from Google Cloud Console.

**Q: What if I modify `requirements.txt`?**
A: Reinstall: `pip install -r basecamp/requirements.txt` (in activated venv).

**Q: Can I run the sync script from outside the trailhead directory?**
A: Not recommended. Stay in the `trailhead/` root for relative imports to work correctly.

---

## Support

- Check `basecamp/python/google_sheets_snapshot.py` for snapshot logic
- Check `basecamp/ops/sync_sheets_to_mysql.py` for full sync implementation
- Check logs from GitHub Actions workflow: https://github.com/admin-mmr/trailhead/actions
