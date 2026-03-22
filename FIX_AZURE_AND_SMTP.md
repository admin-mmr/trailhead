# Fix Azure Connection String & SMTP Issues

## What Was Wrong

The diagnostic showed:
- `AZURE_STORAGE_CONNECTION_STRING: (30 chars)` ← Should be 150+
- `SMTP_USERNAME: NOT SET` ← Needed for email notifications
- `SMTP_PASSWORD: NOT SET` ← Needed for email notifications

### Why Azure String Appeared Truncated

Your `.env.local` file **has the complete Azure connection string**, but the `load-env.sh` script wasn't properly exporting variables with special characters (`+`, `/`, `=`, etc.).

**The issue was:** Variables weren't being quoted when exported, causing the shell to interpret special characters as operators.

## What I Fixed

### 1. Updated `.env.local`
- Added SMTP credentials section
- Explained how to get Gmail App Password

### 2. Fixed `load-env.sh`
- Now uses `set -a` / `set +a` to properly export all variables
- Added validation to show what loaded
- Handles special characters correctly

### 3. What You Need to Do

**Step 1: Set Your Passwords**

Edit `basecamp/.env.local` and update:

```bash
# Line 16 - Fix the database password
DATABASE_URL=mysql://mmradmin:YOUR_ACTUAL_PASSWORD@mmr-mysql.mysql.database.azure.com:3306/mmrdb?ssl=true

# Lines 18-21 - Set Gmail credentials
SMTP_USERNAME=your_gmail@gmail.com
SMTP_PASSWORD=xxxx xxxx xxxx xxxx  # 16-character app password
SMTP_FROM_EMAIL=your_gmail@gmail.com
NOTIFICATION_EMAIL=your_email@example.com
```

**Step 2: Get Gmail App Password**

If you don't have one yet:

1. Go to https://myaccount.google.com/apppasswords
2. Select "Mail" and "Windows Computer" (or your device)
3. Google generates a 16-character password like: `abcd efgh ijkl mnop`
4. Copy it to SMTP_PASSWORD (with or without spaces)

**Step 3: Test the Variables Load Correctly**

```bash
cd basecamp
chmod +x load-env.sh
source load-env.sh
```

Should show:
```
✅ All environment variables loaded from .env.local

Loaded variables:
  ✓ SPREADSHEET_ID: SET
  ✓ DATABASE_URL: (90 chars)
  ✓ AZURE_STORAGE_CONNECTION_STRING: (165 chars)  ← Should now be 165+!
  ✓ SMTP_USERNAME: SET
  ✓ SMTP_PASSWORD: SET
  ✓ GOOGLE_APPLICATION_CREDENTIALS: SET
```

**Step 4: Verify Azure String is Complete**

```bash
source load-env.sh

# Check length
echo "Azure string length: ${#AZURE_STORAGE_CONNECTION_STRING}"

# Check for required parts
echo "Has AccountName: $([ $(echo "$AZURE_STORAGE_CONNECTION_STRING" | grep -c 'AccountName') -eq 1 ] && echo 'YES ✓' || echo 'NO ✗')"
echo "Has AccountKey: $([ $(echo "$AZURE_STORAGE_CONNECTION_STRING" | grep -c 'AccountKey') -eq 1 ] && echo 'YES ✓' || echo 'NO ✗')"
echo "Has EndpointSuffix: $([ $(echo "$AZURE_STORAGE_CONNECTION_STRING" | grep -c 'EndpointSuffix') -eq 1 ] && echo 'YES ✓' || echo 'NO ✗')"
```

All should show YES ✓ and length should be 150+.

**Step 5: Run Diagnostic Again**

```bash
cd basecamp
chmod +x debug-setup.sh
./debug-setup.sh
```

Should now show:
- ✓ AZURE_STORAGE_CONNECTION_STRING: SET (165 chars)
- ✓ SMTP_USERNAME: SET
- ✓ SMTP_PASSWORD: SET

---

## Why This Matters

1. **Azure Connection String** - Stores sync snapshots so we can track what changed in each sync
2. **SMTP Credentials** - Sends you email when a sync fails, so you know to investigate
3. **Proper Export** - Ensures all variables load with their complete values

Without these, GitHub Actions workflows will fail with cryptic errors like "Connection string missing required connection details" or "SMTP authentication failed".

---

## Next: Set GitHub Secrets

Once your `.env.local` is complete, you need to add these values to GitHub Secrets:

```bash
cd basecamp

# For each GitHub secret, get the value from .env.local
source load-env.sh

# View values to copy to GitHub (don't commit these!)
echo "GOOGLE_SHEETS_MEMBERSHIP_ID: $SPREADSHEET_ID"
echo "DATABASE_URL: $DATABASE_URL"
echo "AZURE_STORAGE_CONNECTION_STRING: $AZURE_STORAGE_CONNECTION_STRING"
echo "SMTP_USERNAME: $SMTP_USERNAME"
echo "SMTP_PASSWORD: $SMTP_PASSWORD"
```

Then go to GitHub repo → Settings → Secrets and variables → Actions and add:
- GOOGLE_SHEETS_MEMBERSHIP_ID = (value from SPREADSHEET_ID)
- DATABASE_URL = (full connection string)
- AZURE_STORAGE_CONNECTION_STRING = (full connection string)
- SMTP_USERNAME = (your Gmail)
- SMTP_PASSWORD = (Gmail App Password)
- SMTP_FROM_EMAIL = (your Gmail)
- NOTIFICATION_EMAIL = (where to send failure alerts)
- GOOGLE_APPLICATION_CREDENTIALS = (the full service account JSON or path)

---

## Verify Everything Works

After setting `.env.local` and GitHub Secrets:

```bash
# Test locally
cd basecamp
source load-env.sh
python3 ops/sync_sheets_to_mysql.py --sheet-name "Main" --table-name "members" --dry-run

# Test GitHub Actions
gh workflow run sync-members-recurring.yml
```

Should both succeed.
