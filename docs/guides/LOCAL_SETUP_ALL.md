

# --- Merged from LOCALHOST_SETUP.md ---

# localhost:5050 Setup Guide

## Problem
The `nyrr` alias fails with: `ModuleNotFoundError: No module named 'azure.communication'`

The import chain is:
- `app.py` → imports `api_payments.py`
- `api_payments.py` → imports `payment_actions.py`
- `payment_actions.py` → imports `email_client.py`
- `email_client.py` → needs `azure.communication.email`

This module **is not in `requirements.txt`** and `requirements.txt` is incomplete.

---

## Step-by-Step Fix

### Step 1: Check Python version
```bash
python3 --version
# Should be 3.9+
```

### Step 2: Install/upgrade required packages
```bash
cd ~/github/mmr/trailhead/mmr-admin
pip3 install --upgrade pip
pip3 install -r requirements.txt
```

### Step 3: Install missing Azure module
```bash
pip3 install azure-communication-email --break-system-packages
```

### Step 4: Verify imports
```bash
python3 -c "from azure.communication.email import EmailClient; print('✓ azure.communication imported')"
```

### Step 5: Test database connection
```bash
source load-env.sh
echo "DB_URL: $DATABASE_URL"
mysql-mmr -e "SELECT 1;" 2>&1 | head -5
```

**Expected:** Either `1` (connection OK) or `Can't connect...` (firewall/VPN issue — that's the next step).

### Step 6: Resolve database connectivity (if needed)
If you get `Can't connect to MySQL server`:

**Option A: VPN (Azure-connected network)**
- Ensure you're on the company VPN that allows Azure MySQL access
- Test: `ping mmr-mysql-v4.mysql.database.azure.com`

**Option B: Firewall rule (lasting solution)**
- Ask DevOps to add your home IP to Azure MySQL firewall
- Find your IP: `curl -s ifconfig.me`
- Firewall rule: add IP → `mmr-mysql-v4` → Allow port 3306

**Option C: SSH tunnel (temporary workaround)**
```bash
ssh -L 3306:mmr-mysql-v4.mysql.database.azure.com:3306 jumphost.example.com
# Then connect to localhost:3306 instead
```

### Step 7: Bypass OAuth for local dev (optional)
If Google/Microsoft OAuth isn't configured, set:
```bash
export DEV_BYPASS_AUTH=true
```

### Step 8: Start the app
```bash
nyrr
# Or manually:
cd ~/github/mmr/trailhead/mmr-admin
source load-env.sh
python3 app.py
```

**Expected output:**
```
 * Running on http://127.0.0.1:5050
 * Press CTRL+C to quit
```

Then open http://localhost:5050 in your browser.

---

## Troubleshooting

| Error | Cause | Fix |
|-------|-------|-----|
| `ModuleNotFoundError: azure.communication` | Package not installed | `pip3 install azure-communication-email --break-system-packages` |
| `Can't connect to MySQL server (60)` | Firewall or VPN | Check VPN/firewall, or use SSH tunnel |
| `GOOGLE_SHEETS_MEMBERSHIP_ID not set` | Keychain missing entry | Normal warning — Sheets sync won't work, but app loads |
| `Address already in use` | Port 5050 taken | `lsof -i :5050` then `kill -9 <PID>` |
| `ModuleNotFoundError: <other>` | Missing dependency | Add to `requirements.txt`, then `pip3 install` |

---

## What to do after setup

1. **Verify all endpoints load:**
   - http://localhost:5050 — main dashboard
   - http://localhost:5050/admin — admin panel (if auth bypassed)

2. **Check console for warnings** — some are expected (Sheets sync, SSL version, etc.).

3. **If you edit Python files**, the Flask dev server auto-reloads.

4. **To stop:** Press `CTRL+C` in the terminal.

---

## Requirements.txt is incomplete
Add these to `mmr-admin/requirements.txt`:
```
azure-communication-email>=1.0
```

Then run:
```bash
pip3 install -r requirements.txt --break-system-packages
```


# --- Merged from basecamp/LOCAL_SETUP.md ---

# Local Setup Guide: Testing Syncs on Your Mac

Your sync script is now fixed and ready to test locally. Follow these steps to set up your local environment.

## 1. Set Up Google Credentials in Keychain

First, you need your Google service account JSON file. This should be stored securely in macOS Keychain.

```bash
# Add Google credentials to Keychain
# Replace /path/to/service-account.json with your actual path
security add-generic-password \
    -a keychain_item \
    -s MMR_GOOGLE_CREDS_PATH \
    -w "$(cat /path/to/service-account.json)"
```

Or if you have the path to the file:
```bash
security add-generic-password \
    -a keychain_item \
    -s MMR_GOOGLE_CREDS_PATH \
    -w "/path/to/service-account.json"
```

## 2. Set Up Database URL in Keychain

Store your MySQL connection string in Keychain:

```bash
security add-generic-password \
    -a keychain_item \
    -s MMR_DATABASE_URL \
    -w "mysql://username:password@localhost:3306/mmr_db"
```

**Format**: `mysql://user:password@host:port/database`

Examples:
- Local: `mysql://root:password@localhost:3306/mmr`
- Remote: `mysql://user:pass@remote.host.com:3306/mmr_db`

## 3. Verify Credentials Are Stored

```bash
# Check Google credentials
security find-generic-password -s MMR_GOOGLE_CREDS_PATH -w

# Check database URL
security find-generic-password -s MMR_DATABASE_URL -w
```

Both should return your actual credentials/URLs.

## 4. Update .env.local

Make sure your `.env.local` has these entries:
```bash
# Google Sheets
SPREADSHEET_ID=your_main_spreadsheet_id
GMAIL_TRANSACTION_SHEET_ID=your_gmail_transaction_spreadsheet_id

# Azure
AZURE_STORAGE_CONNECTION_STRING=DefaultEndpointsProtocol=https;AccountName=...

# SMTP for email notifications
SMTP_USERNAME=your-email@gmail.com
SMTP_PASSWORD=your-app-password

# Note: DATABASE_URL and GOOGLE_APPLICATION_CREDENTIALS come from Keychain
```

## 5. Test the Sync

```bash
cd basecamp

# Load environment (will fetch credentials from Keychain)
source load-env.sh

# Verify credentials are loaded
echo "Google creds: $GOOGLE_APPLICATION_CREDENTIALS"
echo "Database URL: ${DATABASE_URL:0:30}..."

# Test dry-run (no database changes)
./run-sync.sh Active gmail_transactions --dry-run
```

**Expected Output:**
```
Loading environment variables...
✅ Environment variables loaded

Loaded variables:
  ✓ SPREADSHEET_ID: SET
  ✓ GMAIL_TRANSACTION_SHEET_ID: SET
  ✓ AZURE_STORAGE_CONNECTION_STRING: OK
  ✓ DATABASE_URL: SET (from Keychain)
  ✓ GOOGLE_APPLICATION_CREDENTIALS: SET (from Keychain)

Running sync: Active → gmail_transactions
  Sheet: Active
  Table: gmail_transactions
  Key Field: TransactionID
  Spreadsheet ID: 1rVOvhXz...
  Mode: DRY RUN (no data will be written)

2026-03-21 23:25:00 - INFO - Created snapshot: abcd1234, 321 rows
2026-03-21 23:25:01 - INFO - First sync for this sheet, treating all rows as added
2026-03-21 23:25:01 - INFO - Detected changes: 321 added, 0 modified, 0 deleted
```

## 6. Test Each Sheet

After successful dry-run, test all four sheets:

```bash
cd basecamp

# Main sheet (members table)
./run-sync.sh Main members --dry-run

# Payment-History sheet (payments table)
./run-sync.sh Payment-History payments --dry-run

# WebApp-Events sheet (events table)
./run-sync.sh WebApp-Events events --dry-run

# Active sheet (gmail_transactions table)
./run-sync.sh Active gmail_transactions --dry-run
```

## 7. Run Actual Sync (Optional)

Once dry-run works, run the actual sync:

```bash
cd basecamp

# Sync members
./run-sync.sh Main members

# Sync payments
./run-sync.sh Payment-History payments

# Sync gmail transactions
./run-sync.sh Active gmail_transactions
```

**Monitor the output for:**
- ✅ Snapshot created
- ✅ Changes detected
- ✅ Rows synced to MySQL
- ✅ No "ContainerNotFound" errors

## Troubleshooting

### Error: "GOOGLE_APPLICATION_CREDENTIALS not found"
```bash
# Check if stored in Keychain
security find-generic-password -s MMR_GOOGLE_CREDS_PATH -w

# If empty, add it again:
security add-generic-password \
    -a keychain_item \
    -s MMR_GOOGLE_CREDS_PATH \
    -w "/path/to/service-account.json"
```

### Error: "DATABASE_URL environment variable not set"
```bash
# Check if stored in Keychain
security find-generic-password -s MMR_DATABASE_URL -w

# If empty, add it:
security add-generic-password \
    -a keychain_item \
    -s MMR_DATABASE_URL \
    -w "mysql://user:pass@host:3306/database"
```

### Error: "Connection refused"
- Verify MySQL is running
- Check DATABASE_URL format: `mysql://user:pass@localhost:3306/db`
- Verify credentials are correct

### Error: "Failed to get Drive metadata"
- Check Google service account has Drive API access
- Verify GOOGLE_APPLICATION_CREDENTIALS path is correct

### Script hangs for >30 seconds
- Likely database connection timeout
- Check MySQL is accessible from your network
- Verify DATABASE_URL is correct

## Next Steps

Once local testing passes:

1. **Set up GitHub Actions secrets** with the same Keychain values
2. **Enable GitHub Actions workflows** in your repo
3. **Test scheduled runs** (every 6 hours as configured)
4. **Monitor sync runs** in GitHub Actions tab



# --- Merged from basecamp/SETUP.md ---

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


# --- Merged from docs/LOCAL_SETUP.md ---

# Local Development Setup

**Last updated**: March 2026
**Prerequisites**: macOS, MySQL client, Python 3.9+, Node.js 18+

---

## 1. Clone & Install

```bash
git clone https://github.com/admin-mmr/trailhead.git
cd trailhead

# Install web app dependencies
cd web-apps/mmr-webapp && npm install && cd ../..

# Install Python sync dependencies
pip install -r basecamp/requirements.txt
```

---

## 2. Environment Variables

All secrets stay out of git. Non-secret config lives in `basecamp/.env.local`; credentials live in macOS Keychain.

### Create `basecamp/.env.local`

Copy the example and fill in the values:

```bash
cp .env.local.example basecamp/.env.local
# then edit basecamp/.env.local with real values
```

Required values in `.env.local`:

```bash
# Google Sheets IDs (from sheet URLs — not secrets)
GOOGLE_SHEETS_MEMBERSHIP_ID=11SFvgApmDtEv4jz5bTYI9_zEhCFMQAXC4b2z_4s3ljk
GOOGLE_SHEETS_PAYMENTS_ID=<your-payments-sheet-id>
GOOGLE_SHEETS_WEBAPP_EVENTS_ID=<your-events-sheet-id>
GMAIL_TRANSACTION_SHEET_ID=1rVOvhXzSxCRpWdAw3jYq5tWrYdCYtXmfqblTHP_wPqA

# MySQL (password goes in Keychain — see Section 3)
MYSQL_HOST=mmr-mysql-v4.mysql.database.azure.com
MYSQL_USER=mmradmin
MYSQL_DATABASE=mmrdb

# Azure Storage
AZURE_STORAGE_CONNECTION_STRING=DefaultEndpointsProtocol=https;AccountName=mmrunnersstorage;AccountKey=<KEY>;EndpointSuffix=core.windows.net

# SMTP (for failure notifications — password goes in Keychain)
MAIL_SERVER=smtp.gmail.com
MAIL_PORT=587
MAIL_USERNAME=<your-gmail>
NOTIFICATION_EMAIL=admin@mmrunners.org
```

### Load env for a session

```bash
source basecamp/load-env.sh
```

This loads `.env.local` and retrieves secrets from Keychain. Always run this before running sync scripts.

---

## 3. MySQL Alias Setup

Set up the `mysql-mmr` shortcut so you can query the DB without typing credentials every time.

### Step 1: Store credentials with `mysql_config_editor`

```bash
mysql_config_editor set --login-path=mmr \
    --host=mmr-mysql-v4.mysql.database.azure.com \
    --user=mmradmin \
    --password
# Enter your MySQL password when prompted
```

Credentials are stored encrypted in `~/.mylogin.cnf`.

### Step 2: Add alias to your shell

**zsh** (`~/.zshrc`):
```bash
alias mysql-mmr='mysql --login-path=mmr -D mmrdb'
```

**bash** (`~/.bash_profile` or `~/.bashrc`):
```bash
alias mysql-mmr='mysql --login-path=mmr -D mmrdb'
```

```bash
source ~/.zshrc   # reload
```

### Step 3: Verify

```bash
mysql-mmr -e "SELECT COUNT(*) as members FROM members;"
```

### Usage

```bash
mysql-mmr                           # interactive shell
mysql-mmr -e "SHOW TABLES;"        # inline query
mysql-mmr < path/to/migration.sql  # run a SQL file
```

---

## 4. Credential Storage (Keychain)

Sensitive values — MySQL password, SMTP password, Google credentials path — are stored in macOS Keychain, never in `.env.local`.

### Add a secret to Keychain

```bash
# MySQL password
security add-generic-password -a "$USER" -s "MMR_DATABASE_URL" \
  -w "mysql://mmradmin:YOUR_PASSWORD@mmr-mysql-v4.mysql.database.azure.com:3306/mmrdb?ssl=true"

# Google service account path
security add-generic-password -a "$USER" -s "MMR_GOOGLE_CREDS_PATH" \
  -w "/path/to/service-account-key.json"

# SMTP / Gmail App Password
security add-generic-password -a "$USER" -s "MMR_SMTP_PASSWORD" \
  -w "your-16-char-app-password"
```

### Update a secret

```bash
security add-generic-password -U -a "$USER" -s "MMR_DATABASE_URL" -w "new-value"
# -U = update if exists
```

### Verify a secret is stored

```bash
security find-generic-password -a "$USER" -s "MMR_DATABASE_URL" -w
```

### Why Keychain?

The `load-env.sh` script reads from Keychain on macOS and falls back to GitHub Secrets in CI. This means:
- No passwords in `.env.local` (which is `.gitignore`d but still risky)
- No passwords in shell history
- Same workflow whether running locally or in CI

### For Linux / CI

Use GitHub Secrets (see `docs/GITHUB_ACTIONS.md`). The `load-env.sh` script detects the OS and reads from the appropriate source.

---

## 5. Run the Web App Locally

```bash
cd web-apps/mmr-webapp
cp .env.local.example .env.local   # fill in DB connection + auth secrets
npm run dev
```

Open `http://localhost:3000`

---

## 6. Run the Sync Locally

```bash
source basecamp/load-env.sh

# Dry run (no writes to DB)
python3 basecamp/ops/sync_sheets_to_mysql.py \
  --sheet "Main" \
  --spreadsheet-id "$GOOGLE_SHEETS_MEMBERSHIP_ID" \
  --dry-run

# Real sync
./basecamp/run-sync.sh Main members
./basecamp/run-sync.sh Payment-History payments
./basecamp/run-sync.sh WebApp-Events payment_events
./basecamp/run-sync.sh Active gmail_transactions
```

---

## 7. Apply a Database Migration

```bash
mysql-mmr < basecamp/migrations/<migration-file>.sql
# or for a manual migration:
mysql -h mmr-mysql-v4.mysql.database.azure.com -u mmradmin -p mmrdb < file.sql
```

---

## New Team Member Checklist

- [ ] Clone repo
- [ ] `npm install` in `web-apps/mmr-webapp/`
- [ ] `pip install -r basecamp/requirements.txt`
- [ ] Create `basecamp/.env.local` with sheet IDs and Azure storage string
- [ ] Add MySQL password to Keychain: `security add-generic-password -a "$USER" -s "MMR_DATABASE_URL" -w "mysql://..."`
- [ ] Set up `mysql-mmr` alias (steps 1–3 above)
- [ ] Test DB connection: `mysql-mmr -e "SELECT 1;"`
- [ ] Test sync: `source basecamp/load-env.sh && ./basecamp/run-sync.sh Main members --dry-run`

---

*See also: `docs/GOOGLE_SHEETS_REFERENCE.md` · `docs/GITHUB_ACTIONS.md` · `docs/AZURE.md`*
