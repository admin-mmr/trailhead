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

