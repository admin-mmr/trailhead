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
