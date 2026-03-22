# Start Debugging Here

Your sync setup has been created, but several issues need to be fixed for it to work. Here's exactly what to do:

## ⚠️ CRITICAL ISSUE (Do This First!)

**Your Google Sheets use column names with spaces like "First Name", "Last Name", etc.**

This BREAKS the sync because the code looks for exact column names without spaces.

**FIX:** Rename ALL column headers in your Google Sheets to remove spaces:
- "First Name" → `FirstName`
- "Last Name" → `LastName`
- "Payment Check" → `PaymentCheck`
- "Last Updated" → `LastUpdated`
- Any other spaces: remove them

**All 4 sheets** need this fix:
1. Main (Members)
2. Payment-History
3. WebApp-Events
4. Active (Gmail)

After fixing, run:
```bash
cd basecamp
python3 ops/verify_sheets_structure.py
```

This will confirm your column names are correct. Should show all ✓ marks.

---

## Next Steps (In Order)

### Step 1: Run the Diagnostic Script
Get a complete status report:

```bash
cd basecamp
chmod +x debug-setup.sh
./debug-setup.sh
```

Fix any ✗ issues shown.

### Step 2: Fix Google Sheets Column Names
See above - this is critical!

### Step 3: Test Locally
Once sheets are fixed, test if syncs work locally:

```bash
cd basecamp
python3 ops/sync_sheets_to_mysql.py --sheet-name "Main" --table-name "members" --dry-run
```

### Step 4: Set Up GitHub Secrets
Your GitHub Actions workflows need secrets configured:

1. Go to your GitHub repo
2. Settings → Secrets and variables → Actions
3. Add these 11+ secrets:
   - GOOGLE_SHEETS_MEMBERSHIP_ID
   - GOOGLE_SHEETS_PAYMENTS_ID
   - GOOGLE_SHEETS_WEBAPP_EVENTS_ID
   - GOOGLE_SHEETS_GMAIL_ID
   - GOOGLE_APPLICATION_CREDENTIALS
   - DATABASE_URL
   - AZURE_STORAGE_CONNECTION_STRING
   - SMTP_USERNAME (Gmail address)
   - SMTP_PASSWORD (Gmail App Password - NOT regular password!)
   - SMTP_FROM_EMAIL
   - NOTIFICATION_EMAIL

### Step 5: Verify Workflows Are Enabled
- Go to Actions tab
- Check all 4 workflows are enabled
- Each should show next scheduled run time

### Step 6: Test Workflows Manually
```bash
gh workflow run sync-members-recurring.yml
```

Wait 1-2 minutes and check Actions tab for results.

---

## Debugging Resources

I've created several files to help you debug:

### 📋 [DEBUG_SYNC_SETUP.md](DEBUG_SYNC_SETUP.md)
Comprehensive debugging guide with explanations of common errors and how to fix them.

### ✅ [TROUBLESHOOTING_CHECKLIST.md](TROUBLESHOOTING_CHECKLIST.md)
Step-by-step checklist to work through systematically. Follow this if you want structured guidance.

### 🧪 [basecamp/TEST_INDIVIDUAL_COMPONENTS.md](basecamp/TEST_INDIVIDUAL_COMPONENTS.md)
Test each component separately to isolate which part is broken.

### 🔧 Scripts to Run

**Auto-diagnostic:**
```bash
cd basecamp && ./debug-setup.sh
```

**Verify Google Sheets structure:**
```bash
cd basecamp && python3 ops/verify_sheets_structure.py
```

**Test individual component:**
Use the examples in `basecamp/TEST_INDIVIDUAL_COMPONENTS.md`

---

## What Should Happen When It Works

✓ Syncs run automatically 4 times per day
✓ Data flows from Google Sheets → MySQL Database
✓ Snapshots saved to Azure Storage
✓ Email notifications sent on failures
✓ Manual test data appears in database tables

---

## The Three Most Common Issues

### 1. "Column not found" errors
**Cause:** Google Sheets column names have spaces
**Fix:** Rename columns to remove spaces (FirstName not "First Name")

### 2. "Connection string error" or "Access denied"
**Cause:** GitHub Secrets not set correctly
**Fix:** Go to repo Settings → Secrets and verify all 11+ secrets are set

### 3. "No data synced despite no errors"
**Cause:** Column names still have spaces OR no test data in sheets
**Fix:**
- Run `verify_sheets_structure.py` to check columns
- Add test data to Google Sheets
- Make sure data isn't hidden/frozen

---

## Quick Checklist to Get Started

- [ ] Rename Google Sheets columns to remove spaces
- [ ] Run `debug-setup.sh` and fix any ✗ issues
- [ ] Set GitHub Secrets (11+ required)
- [ ] Enable all 4 workflows
- [ ] Manually trigger one workflow to test
- [ ] Check database has synced data
- [ ] Verify scheduled runs are working

---

## Getting Detailed Help

**For a specific error message:** Check [DEBUG_SYNC_SETUP.md](DEBUG_SYNC_SETUP.md) - search for your error

**For step-by-step guidance:** Follow [TROUBLESHOOTING_CHECKLIST.md](TROUBLESHOOTING_CHECKLIST.md)

**For technical deep-dive:** Read [basecamp/TEST_INDIVIDUAL_COMPONENTS.md](basecamp/TEST_INDIVIDUAL_COMPONENTS.md)

**For GitHub Actions issues:** Check [GITHUB_ACTIONS_DEBUGGING.md](GITHUB_ACTIONS_DEBUGGING.md)

---

## Still Stuck?

If after following all steps you're still having issues:

1. Run all tests in `basecamp/TEST_INDIVIDUAL_COMPONENTS.md`
2. Note which test(s) fail
3. Get the exact error message
4. Search for that error in the debugging guides above

The tests help isolate whether the problem is:
- Environment variables (Test 1)
- Google credentials (Test 2)
- Google Sheets API (Test 3)
- MySQL database (Test 4)
- Azure Storage (Test 5)
- The sync logic itself (Test 6)

Once you know which component fails, you can focus on fixing just that part.
