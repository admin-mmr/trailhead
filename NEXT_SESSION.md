# Next Session: First-Time MySQL Data Sync

**Session Goal**: Populate MySQL with member data from Google Sheets (complete first-time sync)

**Estimated Time**: 30-45 minutes

**Status**: ⚠️ BLOCKING — Must complete before Epic 1 Phase 2

---

## Quick Start

### Step 1: Verify Setup (5 min)

Run this checklist:

```bash
cd /sessions/admiring-vibrant-fermat/mnt/trailhead

# 1. Check environment variables are set
cat basecamp/.env.local

# 2. Test MySQL connection
mysql -u mmradmin -p -h mmr-mysql.mysql.database.azure.com mmrdb \
  -e "SELECT COUNT(*) as members FROM members;"
# Expected: 0 rows (empty)

# 3. Verify schema migration was applied
mysql -u mmradmin -p -h mmr-mysql.mysql.database.azure.com mmrdb \
  -e "DESCRIBE members;" | grep -E "nyrr_runner_name|year_born"
# Expected: both columns exist
```

**If any fail**: See SYNC_SETUP.md "Troubleshooting" section

### Step 2: Dry Run Sync (10 min)

Test without touching MySQL:

```bash
cd /sessions/admiring-vibrant-fermat/mnt/trailhead
python3 basecamp/ops/sync_sheets_to_mysql.py --dry-run
```

**Expected**: Shows "Would add X members" without writing to MySQL

**If errors**:
- Check SPREADSHEET_ID env var
- Verify Google credentials
- See SYNC_SETUP.md troubleshooting

### Step 3: Execute Real Sync (5 min)

When dry-run succeeds:

```bash
python3 basecamp/ops/sync_sheets_to_mysql.py
```

**Expected**:
```
[INFO] Syncing members to MySQL...
[INFO] Inserted 25 members
[INFO] Sync complete: 25 total members in MySQL
```

### Step 4: Verify Success (5 min)

```bash
# Check member count
mysql -u mmradmin -p -h mmr-mysql.mysql.database.azure.com mmrdb \
  -e "SELECT COUNT(*) as member_count FROM members;"

# Sample a member record
mysql -u mmradmin -p -h mmr-mysql.mysql.database.azure.com mmrdb \
  -e "SELECT member_id, email, first_name, nyrr_runner_name, year_born FROM members LIMIT 1\G"
```

**Success Criteria**:
- ✅ member_count > 0
- ✅ Records have MMR-YYYY-NNNN IDs
- ✅ nyrr_runner_name and year_born are populated (if in sheets)

### Step 5: Test Portal Login (5 min)

1. Go to `http://localhost:3000/login` (or production URL)
2. Use a real member email from the sync
3. Get OTP and log in
4. Verify dashboard shows member info

---

## If Sync Fails

### Common Issues

| Error | Fix |
|-------|-----|
| "SPREADSHEET_ID not defined" | `export SPREADSHEET_ID=<sheet-id>` |
| "Column 'nyrr_id' not found" | Schema v4 migration not applied |
| "Member ID generation failed" | Stored procedure not created; apply migration |
| "Blob storage connection error" | Check AZURE_STORAGE_CONNECTION_STRING |
| "0 members synced" | Check Google Sheet has data; verify column names match header |

**Full troubleshooting**: See `SYNC_SETUP.md`

---

## Key Files & References

| File | Purpose |
|------|---------|
| `SYNC_SETUP.md` | Complete sync documentation + troubleshooting |
| `basecamp/ops/sync_sheets_to_mysql.py` | The sync script (bugs fixed in commits eeccd71) |
| `basecamp/.env.local` | Environment variables (create if missing) |
| `web-apps/mmr-webapp/db/mmr_migration_v4.sql` | Schema migration (must be applied) |
| `WORK_COMPLETED.md` | What was done in previous session |

---

## Success = Next Phase Unlocked

Once sync completes successfully:

1. ✅ Mark SYNC_SETUP.md as COMPLETE
2. ✅ Update WORK_COMPLETED.md with sync date/time
3. ✅ Move to Epic 1 Phase 2: Bi-directional sync
4. ✅ Begin snapshot + change detection work (PROJECT_PLAN.md)

---

## Environment Variables Needed

If running first time:

```bash
# Create/update basecamp/.env.local with:

# Google Service Account (from Google Cloud Console)
GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account-key.json

# Google Sheets ID (from URL: docs.google.com/spreadsheets/d/{ID}/edit)
SPREADSHEET_ID=1ABC123XYZ

# Azure Blob Storage
AZURE_STORAGE_CONNECTION_STRING=DefaultEndpointsProtocol=https;AccountName=mmrunnersstorage;...

# MySQL Database
DATABASE_URL=mysql://mmradmin:PASSWORD@mmr-mysql.mysql.database.azure.com:3306/mmrdb?ssl=true
```

**Ask user to provide these if not already set.**

---

## Git Status

Latest commits:
```
c3653de docs: add phase completion summary for v0.2.0
350bd2d docs: add CHANGELOG and update project docs for v0.2.0 release
2a03d61 fix: 'use client' directive placement and ESLint suppression
eeccd71 schema: remove NYRRMemberID, add NYRRRunnerName + YearBorn
```

All code ready to use. Nothing new needs to be built.

---

## Timeline

**Today (Next Session)**:
- [ ] Verify setup
- [ ] Run dry-run sync
- [ ] Execute real sync
- [ ] Verify MySQL has data
- [ ] Test portal login

**After Sync Works**:
- [ ] Update documentation
- [ ] Commit any changes
- [ ] Begin Epic 1 Phase 2 work

---

## Questions?

- Schema migration issues → See `basecamp/README.md`
- Sync script issues → See `SYNC_SETUP.md` Troubleshooting
- Next phases → See `PROJECT_PLAN.md`
- What was done → See `WORK_COMPLETED.md`

**Ready to execute!**
