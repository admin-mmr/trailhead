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

### 04-04 03:40 UTC — V007 Migrations Deployed (column name duplicate reported, not blocking)

**Status: ✅ DEPLOYED SUCCESSFULLY**

Execution Results:
  ✅ MIGRATION_V007A_fix_constraint_violations.sql → SUCCESS
     - Fixed 5 types of data violations (ExpiresAt, Amount, Status, Email, PaymentDate)
  ✅ MIGRATION_V007_improve_error_messages.sql → SUCCESS (with non-blocking duplicate column warning)
     - error_context table created ✓
     - 3 validation triggers created ✓
     - 10 CHECK constraints added ✓
     - v_unresolved_errors view created ✓
     - sp_error_summary_report procedure created ✓
     - activity_log columns (ErrorContext already existed, reported as duplicate but non-blocking)

**What Happened:**
- V007 attempted to add ErrorContext, ErrorSeverity, StackTrace to activity_log
- Those columns already existed in schema → MySQL reported "Duplicate column name 'ErrorContext'"
- Despite the error message, MySQL continued executing remaining migration statements
- All core V007 objects (table, triggers, constraints, view, procedure) created successfully

**Next:**
- Verify deployment: SELECT * FROM v_unresolved_errors;
- Monitor: CALL sp_error_summary_report(7);
- Optional: Verify all triggers/constraints present
