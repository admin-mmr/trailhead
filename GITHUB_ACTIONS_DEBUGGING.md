# GitHub Actions Sync Debugging Guide

## Problem: Workflows Succeed But No Data Syncs

Your workflows are running without errors (showing as "success"), but the database tables remain empty. Here's how to debug:

---

## Step 1: Check GitHub Actions Logs

### View Workflow Run Logs

1. Go to: https://github.com/admin-mmr/trailhead/actions
2. Click on a workflow (e.g., "💳 Recurring Payments Sync")
3. Click on the latest run
4. Click on the job that ran (e.g., "sync-payments")
5. Expand the **"Run Payments sync"** step
6. Look for output like:
   ```
   [INFO] Syncing payments...
   [INFO] Found X rows in sheet
   [INFO] Inserted Y records
   ```

### Download Sync Logs

1. In the same workflow run, scroll to **Artifacts**
2. Download the log file (e.g., `payments-sync-logs`)
3. Open the log to see detailed sync output

---

## Step 2: Common Reasons for No Data Sync

### Issue 1: Google Sheets Are Empty

**Check**: Open each Google Sheet and verify it has data:
- "Main" sheet (Members)
- "Payment-History" sheet (Payments)
- "WebApp-Events" sheet (WebApp Events)
- "Active" sheet (Gmail Transactions)

If sheets are empty, add test data and re-run the workflow.

### Issue 2: Column Names Don't Match

The sync script expects specific column headers. **Check the sheet headers match:**

**For Members ("Main" sheet):**
```
Required columns (case-sensitive):
- Email (used as key field)
- And other member fields
```

**For Payments ("Payment-History" sheet):**
```
Required columns (case-sensitive):
- PaymentID (used as key field)
- Amount
- PaymentDate
- MembershipType
- PaymentMethod
- PeriodStart
- PeriodEnd
- Source
```

**For WebApp Events ("WebApp-Events" sheet):**
```
Required columns (case-sensitive):
- EventID (used as key field)
- [other event fields]
```

**For Gmail Transactions ("Active" sheet):**
```
Required columns (case-sensitive):
- MessageId (used as key field)
- Sender
- Amount
- Memo
- TransactionDate
```

### Issue 3: Sheet Names Are Incorrect

The workflow calls these exact sheet names:
- `"Main"` (for members)
- `"Payment-History"` (for payments)
- `"WebApp-Events"` (for webapp events)
- `"Active"` (for gmail transactions)

**In your Google Sheet:**
1. Right-click each sheet tab at the bottom
2. Click "Rename"
3. Verify the exact name matches above (case-sensitive)

### Issue 4: Google Sheets API Access

The sync script needs permission to read the sheets.

**Check**:
1. In Google Sheets, share the sheet with your service account email
2. The service account email is in `GOOGLE_SERVICE_ACCOUNT` secret (look for `client_email` field in the JSON)
3. Share with "Viewer" permission (read-only is sufficient)

---

## Step 3: Run Sync Locally to Test

To debug more easily, run a sync locally:

```bash
cd /sessions/jolly-adoring-wozniak/mnt/trailhead
source load-env.sh

# Test Members sync (dry-run first)
python3 basecamp/ops/sync_sheets_to_mysql.py \
  --sheet "Main" \
  --spreadsheet-id "$GOOGLE_SHEETS_MEMBERSHIP_ID" \
  --dry-run

# If that works, run actual sync
python3 basecamp/ops/sync_sheets_to_mysql.py \
  --sheet "Main" \
  --spreadsheet-id "$GOOGLE_SHEETS_MEMBERSHIP_ID"
```

---

## Step 4: Check the Sync Script Output

When running locally, look for these messages:

✅ **Success indicators:**
```
[INFO] Syncing [sheet name] to MySQL...
[INFO] Found X rows in sheet
[INFO] Inserted/Updated Y records
[INFO] Sync complete: Z total records in MySQL
```

❌ **Error indicators:**
```
[ERROR] Sheet not found
[ERROR] Column not found
[ERROR] No matching rows
[ERROR] Database connection failed
```

---

## Checklist: Before Running Workflows Again

- [ ] **Google Sheets exist** with the exact names:
  - [ ] "Main"
  - [ ] "Payment-History"
  - [ ] "WebApp-Events"
  - [ ] "Active"

- [ ] **Column headers match** the required fields (case-sensitive)

- [ ] **Data exists** in each sheet (at least 1 row per sheet)

- [ ] **Service account has access** to the sheets:
  - [ ] Find `client_email` in `GOOGLE_SERVICE_ACCOUNT` secret
  - [ ] Share each sheet with this email address (Viewer permission)

- [ ] **All GitHub Secrets are set** correctly:
  - [ ] `GOOGLE_SERVICE_ACCOUNT` (valid JSON)
  - [ ] `GOOGLE_SHEETS_MEMBERSHIP_ID` (correct sheet ID)
  - [ ] `GOOGLE_SHEETS_PAYMENTS_ID` (correct sheet ID)
  - [ ] `GOOGLE_SHEETS_WEBAPP_EVENTS_ID` (correct sheet ID)
  - [ ] `GMAIL_TRANSACTION_SHEET_ID` (correct sheet ID)
  - [ ] All MySQL secrets correct
  - [ ] Email secrets correct

---

## Debug: Run a Manual Workflow

1. Go to: https://github.com/admin-mmr/trailhead/actions
2. Click "💳 Recurring Payments Sync"
3. Click "Run workflow" button
4. Select your branch
5. Click "Run workflow"
6. **Wait for completion**
7. Check the logs (see Step 1 above)
8. If it synced, you'll see in logs:
   ```
   [INFO] Inserted X records
   ```
9. Check MySQL:
   ```bash
   mysql -h $MYSQL_HOST -u $MYSQL_USER -p -D $MYSQL_DATABASE \
     -e "SELECT COUNT(*) FROM payments;"
   ```

---

## Example: Add Test Data to Google Sheets

If sheets are empty, add one test row:

**"Main" sheet (Members):**
| Email | FirstName | LastName | ... |
|-------|-----------|----------|-----|
| test@example.com | Test | User | ... |

**"Payment-History" sheet:**
| PaymentID | Amount | PaymentDate | MembershipType | PaymentMethod | ... |
|-----------|--------|-------------|----------------|----------------|-----|
| PAY001 | 100 | 2026-03-20 | Individual | Zelle | ... |

Then re-run the workflow and check if data synced.

---

## Still Not Working?

1. **Check the workflow run logs** (most important!)
   - The sync script outputs detailed info about what it found
   - Look for error messages

2. **Verify column names exactly match** (case-sensitive!)
   - Copy-paste from the sheet headers to be sure

3. **Test locally first**:
   ```bash
   source load-env.sh
   python3 basecamp/ops/sync_sheets_to_mysql.py --sheet "Main" --dry-run
   ```

4. **Check Google Sheets API quota**
   - Go to Google Cloud Console
   - Verify API is enabled
   - Check quota usage

5. **Ask for help** with:
   - The error message from the workflow logs
   - The sheet names (screenshot)
   - The column headers (screenshot)

---

## Quick Reference: Expected Data After Sync

After syncs work, you should see:

```
Table Name              Current  Expected
members                 616      ✅ Already populated
payments                0        → Should increase (once sheet has data)
payment_events          0        → Should increase (once sheet has data)
gmail_transactions      0        → Should increase (once sheet has data)
```

If sheets have data but tables stay empty, the issue is with the sync script itself or column mismatches.

---

**Last resort**: Run `schema_inspector.py` after each manual workflow run:

```bash
python3 basecamp/ops/schema_inspector.py --summary
```

This shows the current row counts to help you track progress.
