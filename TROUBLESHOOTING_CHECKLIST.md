# Sync Job Troubleshooting Checklist

Use this checklist to systematically work through and fix any issues with your sync setup.

## Phase 1: Environment & Variables (5 minutes)

- [ ] **Run the diagnostic script**
  ```bash
  cd basecamp
  chmod +x debug-setup.sh
  ./debug-setup.sh
  ```
  Fix any ✗ items that appear

- [ ] **Verify Azure connection string is complete**
  ```bash
  source load-env.sh
  echo "Length: ${#AZURE_STORAGE_CONNECTION_STRING}"
  [[ "$AZURE_STORAGE_CONNECTION_STRING" == *"AccountKey"* ]] && echo "✓ Has AccountKey" || echo "✗ Missing AccountKey"
  ```
  Should show length 150+ and have AccountKey

- [ ] **Check database connection string format**
  ```bash
  echo "$DATABASE_URL" | head -c 60
  ```
  Should start with `mysql://username:password@host:port/database`

## Phase 2: Google Sheets Structure (10 minutes)

⚠️ **CRITICAL ISSUE:** Your sheets currently use spaces in column names ("First Name", "Last Name", etc.)
These MUST be changed to PascalCase with no spaces.

### Action: Fix Column Names

For EACH of these 4 sheets, rename the columns:

**Main Sheet (Members tab):**
- [ ] "First Name" → FirstName
- [ ] "Last Name" → LastName
- [ ] "Payment Check" → PaymentCheck (if you have this)
- [ ] "Last Updated" → LastUpdated (if you have this)
- [ ] Any other columns with spaces: remove the spaces

**Payment-History Sheet:**
- [ ] Check column names and remove any spaces
- [ ] Expected columns: PaymentID, MemberEmail, Amount, Method, Date, Status

**WebApp-Events Sheet:**
- [ ] Check column names and remove any spaces
- [ ] Expected columns: EventID, EventName, EventDate, Location, MemberEmail

**Active Sheet (Gmail):**
- [ ] Check column names and remove any spaces
- [ ] Expected columns: MessageID, From, Subject, Date, Amount, Status

### Verify the fix:
```bash
cd basecamp
python3 ops/verify_sheets_structure.py
```
Should show all ✓ for each expected column

## Phase 3: Add Test Data (5 minutes)

- [ ] **Add at least one test row to Main sheet**
  - FirstName: TestFirstName
  - LastName: TestLastName
  - Email: test@example.com
  - (Leave other columns blank or fill with placeholder data)

- [ ] **Add at least one test row to each other sheet** with minimum required data

## Phase 4: Local Testing (10 minutes)

- [ ] **Run with dry-run first** (no data will be written)
  ```bash
  cd basecamp
  python3 ops/sync_sheets_to_mysql.py \
    --sheet-name "Main" \
    --table-name "members" \
    --dry-run
  ```
  Should show:
  - ✓ Successfully read X rows from Google Sheets
  - ✓ Would sync X rows to database
  - No errors

- [ ] **If dry-run works, run actual sync**
  ```bash
  cd basecamp
  python3 ops/sync_sheets_to_mysql.py \
    --sheet-name "Main" \
    --table-name "members"
  ```
  Should show:
  - ✓ X rows synced successfully
  - ✓ Snapshot saved to Azure

- [ ] **Verify data in database**
  ```bash
  # Get MySQL connection details from .env.local
  source load-env.sh

  # Query the database (replace user/password/host with values from DATABASE_URL)
  mysql -h your-host -u your-user -p your-database -e "SELECT COUNT(*) FROM members;"
  ```
  Should show at least 1 row

## Phase 5: GitHub Actions Setup (15 minutes)

- [ ] **Go to GitHub repository settings**
  - Settings → Secrets and variables → Actions

- [ ] **Verify all required secrets are set:**
  - [ ] GOOGLE_SHEETS_MEMBERSHIP_ID
  - [ ] GOOGLE_SHEETS_PAYMENTS_ID
  - [ ] GOOGLE_SHEETS_WEBAPP_EVENTS_ID
  - [ ] GOOGLE_SHEETS_GMAIL_ID
  - [ ] GOOGLE_APPLICATION_CREDENTIALS (base64 or JSON content)
  - [ ] DATABASE_URL
  - [ ] AZURE_STORAGE_CONNECTION_STRING
  - [ ] SMTP_USERNAME
  - [ ] SMTP_PASSWORD
  - [ ] SMTP_FROM_EMAIL
  - [ ] NOTIFICATION_EMAIL

  For GOOGLE_APPLICATION_CREDENTIALS, you can either:
  - Store the full JSON credentials content as the secret value, OR
  - Store the path to the credentials file, OR
  - Use `echo $(cat /path/to/creds.json | base64)` to encode it

- [ ] **Enable the workflow files**
  - Go to Actions tab
  - Each of the 4 workflows should show as enabled
  - If any show "Disabled", click and enable

- [ ] **Set the database firewall rule**
  - Go to Azure Portal
  - Find your MySQL database
  - Add firewall rule: "Allow access to Azure services" (or add GitHub Actions IP range)

## Phase 6: Test GitHub Actions Manually (10 minutes)

- [ ] **Trigger one workflow manually**
  ```bash
  # From your repo directory
  gh workflow run sync-members-recurring.yml
  ```

- [ ] **Wait 1-2 minutes, then check status**
  ```bash
  gh workflow run list
  ```

- [ ] **Check the run details**
  - Go to Actions tab
  - Click the "sync-members-recurring" workflow
  - Click the latest run
  - Expand "Sync" step to see output
  - Check for errors

- [ ] **If successful, download the logs**
  - Expand "Upload sync logs" artifact section
  - Download sync-logs.txt

- [ ] **If failed, check what went wrong**
  - Errors usually appear in the "Sync" step
  - Common issues:
    - Secrets not set correctly
    - Column names don't match
    - Database connection failed
    - Google credentials invalid

## Phase 7: Verify All Four Workflows (10 minutes)

For EACH of the four sync workflows:

- [ ] **sync-members-recurring**
  - [ ] Trigger manually
  - [ ] Check for successful run
  - [ ] Verify members table has data

- [ ] **sync-payments-recurring**
  - [ ] Trigger manually
  - [ ] Check for successful run
  - [ ] Verify payments table has data

- [ ] **sync-webapp-events-recurring**
  - [ ] Trigger manually
  - [ ] Check for successful run
  - [ ] Verify payment_events table has data

- [ ] **sync-gmail-transactions-recurring**
  - [ ] Trigger manually
  - [ ] Check for successful run
  - [ ] Verify gmail_transactions table has data

## Phase 8: Confirm Scheduled Execution

- [ ] **Each workflow should show next scheduled run**
  - Members: Every day at 00:00, 06:00, 12:00, 18:00 UTC
  - Payments: Every day at 01:00, 07:00, 13:00, 19:00 UTC
  - WebApp Events: Every day at 02:00, 08:00, 14:00, 20:00 UTC
  - Gmail: Every day at 03:00, 09:00, 15:00, 21:00 UTC

- [ ] **Gmail app password is set** (for SMTP notifications)
  - Go to Google Account settings
  - Enable 2-Step Verification if not already done
  - Generate an App Password
  - Use this (not your regular password) for SMTP_PASSWORD

## Troubleshooting Tips

### If "Column not found" errors appear:
1. Check column names in Google Sheets (must have NO spaces)
2. Run `verify_sheets_structure.py` to see exactly what columns it found
3. Rename any columns with spaces

### If "Connection string error" appears:
1. Check that AZURE_STORAGE_CONNECTION_STRING is completely loaded
2. Run: `echo "${#AZURE_STORAGE_CONNECTION_STRING}"`
3. Should be 150+ characters, if less than 50, variable didn't load

### If "Access denied" appears:
1. Check that all GitHub Secrets are set correctly
2. Verify GOOGLE_APPLICATION_CREDENTIALS is set (not just the path)
3. Check database firewall allows GitHub Actions IPs

### If workflows don't show in Actions tab:
1. Make sure `.github/workflows/` directory exists
2. Make sure all 4 YAML files are committed to GitHub
3. Push to main/master branch
4. Wait 1-2 minutes and refresh Actions tab

### If no data syncs despite no errors:
1. Check that Google Sheets have actual data rows (not just headers)
2. Run `verify_sheets_structure.py` to ensure columns match
3. Check that the test data you added is still there
4. Try a dry-run locally first to see if Google Sheets can be read

## Getting Help

If you're stuck:

1. **Check the sync log**: Look at the detailed output from a failed run
2. **Run the diagnostic**: `cd basecamp && ./debug-setup.sh`
3. **Verify sheets structure**: `python3 ops/verify_sheets_structure.py`
4. **Test locally first**: Before trying GitHub Actions, test with `python3 ops/sync_sheets_to_mysql.py`

---

**When everything is working:**
- All 4 workflows are enabled and scheduled
- Syncs run automatically 4 times per day (staggered)
- Data flows from Google Sheets → MySQL
- Snapshots are saved to Azure Storage
- You get email notifications if a sync fails
- Manual test data syncs successfully to database
