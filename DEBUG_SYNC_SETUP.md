# Sync Job Debugging Guide

## Quick Status Check

Run this to see the current state of your setup:

```bash
cd basecamp
source load-env.sh
echo "=== Environment Variables ==="
echo "SPREADSHEET_ID: ${SPREADSHEET_ID:-(NOT SET)}"
echo "GOOGLE_SHEETS_MEMBERSHIP_ID: ${GOOGLE_SHEETS_MEMBERSHIP_ID:-(NOT SET)}"
echo "DATABASE_URL: ${DATABASE_URL:-(NOT SET)}" | head -c 80
echo "..."
echo "AZURE_STORAGE_CONNECTION_STRING length: ${#AZURE_STORAGE_CONNECTION_STRING}"
```

## Debugging Issues

### Issue 1: AZURE_STORAGE_CONNECTION_STRING Appears Truncated

**Why it happens:** Long strings in terminal may wrap or appear cut off.

**Verify it's actually loaded:**
```bash
# Check the LENGTH of the variable (should be 150+ characters)
echo "Azure string length: ${#AZURE_STORAGE_CONNECTION_STRING}"

# Check if it contains expected parts (should all show "found")
[[ "$AZURE_STORAGE_CONNECTION_STRING" == *"DefaultEndpointsProtocol"* ]] && echo "✓ Protocol found" || echo "✗ Protocol missing"
[[ "$AZURE_STORAGE_CONNECTION_STRING" == *"AccountName"* ]] && echo "✓ AccountName found" || echo "✗ AccountName missing"
[[ "$AZURE_STORAGE_CONNECTION_STRING" == *"AccountKey"* ]] && echo "✓ AccountKey found" || echo "✗ AccountKey missing"
[[ "$AZURE_STORAGE_CONNECTION_STRING" == *"EndpointSuffix"* ]] && echo "✓ EndpointSuffix found" || echo "✗ EndpointSuffix missing"
```

### Issue 2: Google Sheets Column Names Have Spaces

**Problem:** Headers like "First Name", "Last Name" won't be found by code looking for "FirstName", "LastName"

**Fix:** You must rename columns in ALL four Google Sheets:

1. **Main Sheet (Members):**
   - "First Name" → FirstName
   - "Last Name" → LastName
   - "Payment Check" → PaymentCheck
   - "Last Updated" → LastUpdated
   - Any other spaces: remove them or replace with camelCase

2. **Payment-History Sheet:**
   - Rename any columns with spaces to remove spaces (PaymentID, MemberEmail, etc.)

3. **WebApp-Events Sheet:**
   - Same pattern: no spaces in headers

4. **Active Sheet (Gmail):**
   - Same pattern: no spaces in headers

**How to verify sheets have correct names:**
```bash
# Run the sheet structure verification
python3 basecamp/ops/verify_sheets_structure.py
```

### Issue 3: Database Connection Issues

**Test MySQL connectivity:**
```bash
# Extract connection details
source load-env.sh
DB_HOST=$(echo "$DATABASE_URL" | grep -oP '(?<=@)[^/]+' || echo "NOT_FOUND")
echo "Database host: $DB_HOST"

# Test with MySQL client (if installed)
mysql -h "$DB_HOST" -u "$DB_USER" -p"$DB_PASSWORD" -e "SELECT 1;" 2>&1 | head -5
```

### Issue 4: Google Sheets API Authentication

**Test API access:**
```bash
cd basecamp
python3 << 'EOF'
import json
from google.oauth2 import service_account
from google.sheets import Sheets

try:
    with open('.env.local') as f:
        for line in f:
            if 'GOOGLE_APPLICATION_CREDENTIALS' in line:
                creds_path = line.split('=')[1].strip()
                break

    creds = service_account.Credentials.from_service_account_file(creds_path)
    print("✓ Google credentials loaded successfully")
    print(f"  Service account: {creds.service_account_email}")
except Exception as e:
    print(f"✗ Google credentials error: {e}")
EOF
```

### Issue 5: Workflows Not Running

**Check GitHub Actions workflow status:**
1. Go to your repository's "Actions" tab
2. Look for the four sync workflows:
   - sync-members-recurring
   - sync-payments-recurring
   - sync-webapp-events-recurring
   - sync-gmail-transactions-recurring
3. Click each one and check:
   - Is it enabled? (toggle at bottom left)
   - What's the next scheduled run time?
   - Any errors in recent runs?

**Manually trigger a workflow:**
```bash
gh workflow run sync-members-recurring.yml
```

## Step-by-Step Verification Checklist

- [ ] **Step 1:** Run load-env.sh and verify all variables are non-empty
- [ ] **Step 2:** Check AZURE_STORAGE_CONNECTION_STRING length (should be 150+ chars)
- [ ] **Step 3:** Rename all Google Sheets columns to remove spaces
- [ ] **Step 4:** Run a test sync locally with `python3 basecamp/ops/sync_sheets_to_mysql.py --help`
- [ ] **Step 5:** Check GitHub Secrets are set (Settings → Secrets and variables → Actions)
- [ ] **Step 6:** Verify GitHub Actions workflows are enabled
- [ ] **Step 7:** Check database firewall allows Azure/GitHub IP ranges
- [ ] **Step 8:** Add test data to Google Sheets
- [ ] **Step 9:** Manually trigger one workflow to test
- [ ] **Step 10:** Check MySQL tables for synced data

## Common Error Messages and Fixes

### "Connection string missing required connection details"
**Cause:** AZURE_STORAGE_CONNECTION_STRING is incomplete or not loaded
**Fix:**
```bash
# Verify it's in .env.local
grep AZURE_STORAGE_CONNECTION_STRING basecamp/.env.local

# Make sure it starts with DefaultEndpointsProtocol= and contains AccountKey=
```

### "Sheet not found" or "Column not found"
**Cause:** Spreadsheet ID is wrong OR column headers don't match expected names
**Fix:**
- Check SPREADSHEET_ID in .env.local matches actual Google Sheet ID
- Rename all columns to match expected names (no spaces, exact case)

### "Access denied" from GitHub Actions
**Cause:** GitHub Secrets not set, or wrong secret names used
**Fix:**
- Go to Settings → Secrets and variables → Actions
- Verify all 11+ required secrets exist
- Check the secret name exactly matches what's in the workflow YAML

### "Rows synced: 0"
**Cause:** Either no data in Google Sheet, or columns don't match
**Fix:**
- Check Google Sheet has data in the rows
- Check column headers match exactly (case-sensitive, no spaces)
- Add test row manually if sheet is empty

## Advanced Debugging

### Test individual script components:
```bash
cd basecamp

# Test Google Sheets API connection only
python3 -c "from utils.google_sheets import GoogleSheetsClient; print('✓ Can import GoogleSheetsClient')"

# Test MySQL connection only
python3 -c "from utils.mysql_client import MySQLClient; print('✓ Can import MySQLClient')"

# Test Azure connection only
python3 -c "from utils.azure_storage import AzureBlobClient; print('✓ Can import AzureBlobClient')"

# Test the full sync with verbose logging
python3 ops/sync_sheets_to_mysql.py --sheet-name "Main" --table-name "members" --verbose
```

### Check sync logs from GitHub Actions:
1. Go to Actions tab
2. Click a workflow run
3. Expand "Sync" step to see output
4. Download artifact "sync-logs" for detailed logs

### Monitor real-time with Azure Storage Explorer:
1. Install Azure Storage Explorer (free)
2. Connect using the AZURE_STORAGE_CONNECTION_STRING
3. Check for snapshot folders being created during syncs
4. Verify diffs are being detected

## What Should Happen When Everything Works

1. **Locally:** Run `python3 basecamp/ops/sync_sheets_to_mysql.py --sheet-name "Main" --table-name "members"` → sees data sync to MySQL
2. **GitHub Actions:** Workflows run on schedule, check artifact logs
3. **Database:** `SELECT COUNT(*) FROM members;` shows data
4. **Diffs:** Snapshot files in Azure showing what changed each sync

## Questions to Answer When Debugging

1. Which step fails first?
   - Environment loading?
   - Google Sheets API connection?
   - MySQL connection?
   - Azure connection?

2. Is data actually in your Google Sheets?
   - Check the sheet has rows with data
   - Check columns match expected names (no spaces!)

3. Are credentials actually valid?
   - Can you manually open the Google Sheet in browser?
   - Can you manually query the MySQL database?
   - Can you access Azure Storage in portal?

4. Is the sync logic correct?
   - Check basecamp/ops/sync_sheets_to_mysql.py exists
   - Check it can be imported without errors
   - Check column mapping matches your actual sheet structure

---

**Need more help?** Check the file `/sessions/jolly-adoring-wozniak/mnt/trailhead/GITHUB_ACTIONS_DEBUGGING.md` for GitHub Actions specific issues.
