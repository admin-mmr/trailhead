# First-Time Google Sheets → MySQL Sync Setup

**Current Status**: ⚠️ Schema ready, sync script fixed, but NO DATA in MySQL yet
**Priority**: HIGH — Complete this before moving to Epic 1 Phase 2

---

## What Needs to Happen

The MySQL database is empty. We need to populate it with member data from Google Workspace/Google Sheets.

### Why It Hasn't Happened Yet
1. Schema migration (v4) — ✅ Created and tested
2. Sync script fixes — ✅ 3 critical bugs fixed
3. Code deployment — ❓ Not yet run
4. First-time data load — ⏸️ BLOCKED — Need to execute sync

---

## Prerequisites Check

Before running the sync, verify you have:

### 1. Environment Variables Set

**File**: `basecamp/.env.local` (should exist)

```bash
# Required for first-time sync:
GOOGLE_APPLICATION_CREDENTIALS=<path-to-service-account-json>
AZURE_STORAGE_CONNECTION_STRING=<azure-connection-string>
DATABASE_URL=mysql://mmradmin:<password>@mmr-mysql.mysql.database.azure.com:3306/mmrdb?ssl=true
SPREADSHEET_ID=<your-membership-master-sheet-id>
```

**Check**:
```bash
cd /sessions/admiring-vibrant-fermat/mnt/trailhead
cat basecamp/.env.local | grep -E "GOOGLE|AZURE|DATABASE|SPREADSHEET"
```

### 2. Database Connection

Test MySQL connection:
```bash
mysql -u mmradmin -p -h mmr-mysql.mysql.database.azure.com mmrdb -e "SELECT COUNT(*) as member_count FROM members;"
```

**Expected** (before sync): `0` rows
**After sync**: Should show actual member count from Google Sheets

### 3. Azure Blob Storage Access

Test blob storage:
```bash
python3 -c "
from azure.storage.blob import BlobServiceClient
import os
client = BlobServiceClient.from_connection_string(os.environ['AZURE_STORAGE_CONNECTION_STRING'])
print('✅ Blob storage connected')
"
```

### 4. Google Service Account Credentials

Verify service account has:
- ✅ Access to Google Sheets (read)
- ✅ Access to Google Drive (read file metadata)
- ✅ Access to Google Workspace (read members)

```bash
python3 -c "
import json
with open(os.environ['GOOGLE_APPLICATION_CREDENTIALS']) as f:
    creds = json.load(f)
    print(f'Service Account: {creds[\"client_email\"]}')
    print(f'Project: {creds[\"project_id\"]}')
"
```

---

## Running the Sync

### Option 1: Dry Run (Recommended First)

Test without touching MySQL:

```bash
cd /sessions/admiring-vibrant-fermat/mnt/trailhead
python3 basecamp/ops/sync_sheets_to_mysql.py --dry-run
```

**Expected Output**:
```
[INFO] Dry-run mode: No MySQL writes
[INFO] Snapshot loaded: 25 members from Google Sheets
[INFO] New members to add: 25
[INFO] Members to update: 0
[INFO] Summary: Would add 25, update 0, delete 0
[INFO] Dry-run complete - no changes made
```

**If errors**:
- Check env vars are loaded
- Verify Google Sheets SPREADSHEET_ID is correct
- Check Azure blob storage connection
- See "Troubleshooting" section below

### Option 2: Actual Sync

Once dry-run succeeds:

```bash
cd /sessions/admiring-vibrant-fermat/mnt/trailhead
python3 basecamp/ops/sync_sheets_to_mysql.py
```

**Expected Output**:
```
[INFO] Snapshot loaded: 25 members from Google Sheets
[INFO] Previous snapshot found: 0 members
[INFO] Change detection: 25 new, 0 updated, 0 deleted
[INFO] Syncing members to MySQL...
[INFO] Inserted 25 members
[INFO] Member ID generation used stored procedure
[INFO] Sync complete: 25 total members in MySQL
```

**Verify**:
```bash
mysql -u mmradmin -p -h mmr-mysql.mysql.database.azure.com mmrdb \
  -e "SELECT COUNT(*) as member_count FROM members;"
```

Should show member count > 0

---

## What Gets Synced

From Google Sheets "Membership Master" with canonical header:
```
MemberID, Status, Created, Expiration, Email, First Name, Last Name, Type,
FamilyID, Gender, WeChatID, District, WebApp, Payment Check, Info,
Last Updated, Membership Fee Paid, Payment Date, Payment Transaction,
JoinYear, PhoneNumber, LastLoginDate, Notes, NYRRRunnerName, YearBorn
```

Maps to MySQL `members` table with these fields:
- `member_id` — MMR-YYYY-NNNN (auto-generated)
- `email` — Primary key
- `first_name`, `last_name` — Name fields
- `status` — Active/Inactive/etc
- `nyrr_runner_name` — For NYRR bib lookup
- `year_born` — For age calculation
- ... and 18 other fields

---

## Troubleshooting

### Error: "GOOGLE_APPLICATION_CREDENTIALS not found"

**Fix**:
```bash
export GOOGLE_APPLICATION_CREDENTIALS="/path/to/service-account-key.json"
# Add to basecamp/.env.local:
GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account-key.json
```

### Error: "SPREADSHEET_ID not found or not readable"

**Fix**:
```bash
# Get the sheet ID from the URL:
# https://docs.google.com/spreadsheets/d/1ABC123XYZ/edit
# ID = 1ABC123XYZ

export SPREADSHEET_ID="1ABC123XYZ"
# Add to basecamp/.env.local:
SPREADSHEET_ID=1ABC123XYZ
```

### Error: "Blob storage: no previous snapshot"

**Normal on first run** — Script will create one.

### Error: "Member ID generation failed - stored procedure not found"

**Fix**: Schema migration v4 not applied. Run:
```bash
mysql -u mmradmin -p -h mmr-mysql.mysql.database.azure.com mmrdb < \
  web-apps/mmr-webapp/db/mmr_migration_v4.sql
```

### Error: "Column 'nyrr_id' doesn't exist"

**Fix**: Schema uses `nyrr_runner_name` not `nyrr_id`. Verify migration v4 was applied.

### Sync runs but MySQL still empty

**Debug**:
```bash
# Check if MySQL connection works:
mysql -u mmradmin -p -h mmr-mysql.mysql.database.azure.com mmrdb \
  -e "SHOW TABLES; SELECT COUNT(*) FROM members;"

# Check sync_metadata table:
mysql -u mmradmin -p -h mmr-mysql.mysql.database.azure.com mmrdb \
  -e "SELECT * FROM sync_metadata;"

# Check blob storage has snapshot:
# (Would need Azure CLI to verify)
```

---

## Success Criteria

✅ Sync Complete When:
1. `mysql ... SELECT COUNT(*) FROM members;` returns actual member count (not 0)
2. Member records have:
   - `member_id` in format MMR-YYYY-NNNN
   - `email` populated
   - `nyrr_runner_name` populated (if provided in sheets)
   - `year_born` populated (if provided in sheets)
3. No errors in sync log
4. `sync_metadata` table shows latest sync timestamp

---

## After First Sync Succeeds

### Next Steps
1. ✅ Verify member count matches Google Sheets
2. ✅ Test portal login with real member account
3. ✅ Check NYRR field mapping (nyrr_runner_name)
4. ✅ Move to Epic 1 Phase 2 (bi-directional sync)

### Schedule Nightly Sync
Once working, set up GitHub Actions:
- Create `.github/workflows/sync-sheets-to-mysql.yml`
- Schedule for 2 AM UTC daily
- See PROJECT_PLAN.md for template

---

## Files Modified This Phase

- `basecamp/ops/sync_sheets_to_mysql.py` — 3 bugs fixed
- `web-apps/mmr-webapp/db/mmr_migration_v4.sql` — Schema migration
- `basecamp/.env.example` — Environment variables documented

---

## Related Documentation

- [`WORK_COMPLETED.md`](WORK_COMPLETED.md) — What was done in schema refactor
- [`PROJECT_PLAN.md`](PROJECT_PLAN.md) — Full roadmap
- [`basecamp/README.md`](basecamp/README.md) — Schema procedures
- [`DEPLOYMENT.md`](DEPLOYMENT.md) — How to deploy migrations

---

**BLOCKING ISSUE**: First-time sync needs to be executed before proceeding to Epic 1 Phase 2.
Once sync succeeds, update this file's status to ✅ COMPLETE.
