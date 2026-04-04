### 04-03 22:30 UTC — GAS webhook handlers for MySQL→Sheets write

**Changed:**
1. web-apps/gas/membership/src/config.ts: Added SQL_MEMBERS, SQL_PAYMENTS, SQL_SUBMISSIONS to SHEET_NAMES ✅
2. web-apps/gas/membership/src/webhook.ts: Added handleWriteRange() + handleReadRange() action handlers ✅
   • write_range: Appends rows to SQL_* tabs (MySQL→Sheets export)
   • read_range: Reads columns from Main/Payment-History/WebApp-Events (Sheets→MySQL import)

**Status:**
- TypeScript compiles successfully (no errors)
- New action handlers integrated into doPost() switch
- Generic sync_runner can now call gas_webhook with write_range/read_range actions
- Export flow complete: Flask → Python → GAS webhook → SQL tabs in Sheets

**Next:**
- Deploy GAS changes to Google Apps Script project
- Create "SQL Members", "SQL Payments", "SQL Submissions" tabs in Sheets
- Test export_members route (POST /api/sync/export/members)
- Test import_members route (POST /api/sync/import/members)

### 04-03 22:20 UTC — Add insert-only import_members sync mode

**Changed:**
1. Added import_members config to SYNC_CONFIG: Sheets→MySQL, Main sheet, mode=insert_only (uses INSERT IGNORE) ✅
2. Updated generic_sync_runner: Supports both upsert and insert_only modes; different SQL + logging ✅
3. Added sync_import_members() wrapper in sync_runners.py ✅
4. Added POST /api/sync/import/members route in api_sheets_sync_routes.py ✅
5. Synced basecamp/python/sync_config.py → mmr-admin/sync_config.py ✅

**Status:**
- 6 total configs: 4 export (MySQL→Sheets) + 2 import (Sheets→MySQL, one insert_only)
- import_members: reads all 22 member columns from Main sheet, inserts only new MemberIDs (skips duplicates)
- import_transactions: upserts (insert or update) with Source→PaymentMethod mapping
- All routes compile; imports verified
- Ready to register blueprint in app.py

**Next:**
- Register api_sheets_sync_routes blueprint in app.py (line 162)
- Test import_members: POST /api/sync/import/members
- Verify duplicate MemberIDs are skipped (INSERT IGNORE behavior)

### 04-04 03:35 UTC — V007 2-step migration: data cleanup + error tracking

**Changed:**
1. ✅ Deleted: MIGRATION_V006_mysql_ssot.sql (executed on production)
2. ✅ Deleted: MIGRATION_ADD_SUBJECT_TO_GMAIL_TRANSACTIONS.sql (executed on production)
3. ✅ Identified V007 failure: Line 122 CHECK constraint violated (ExpiresAt <= CreatedAt in existing data)
4. ✅ Created: MIGRATION_V007A_fix_constraint_violations.sql (152 lines, 7 sections):
   - Fixes ExpiresAt <= CreatedAt → set to NULL
   - Fixes negative Amount → set to NULL
   - Fixes invalid Status → set to 'pending'/'active'
   - Fixes invalid Email → set to NULL
   - Fixes invalid PaymentDate → set to NULL
5. ✅ Updated: MIGRATION_V007_improve_error_messages.sql adds prerequisite note
6. ✅ Created: MIGRATION_EXECUTION_GUIDE.md (step-by-step, verification, rollback)

**Status:**
- ✅ Two-step migration ready:
  1. MIGRATION_V007A_fix_constraint_violations.sql (data cleanup, <1 min)
  2. MIGRATION_V007_improve_error_messages.sql (error tracking, 2-3 min)
- ✅ GitHub Actions will auto-run both in correct order (V007A before V007)
- ✅ All documentation updated (CLAUDE.md, _context.md, guides)

**Next:**
- Push both MIGRATION_V007*.sql to main
- GitHub Actions executes V007A → V007 automatically
- Verify with: SELECT * FROM v_unresolved_errors;
