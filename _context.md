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

### 04-04 03:55 UTC — V007 Corrected: Added schema_migrations registration + cleanup

**Status: ✅ V007 CORRECTED + REGISTERED**

Issues Fixed:
  ❌ V007 was not registering in schema_migrations table (no INSERT statement)
  ❌ V008 was created but now obsolete (cleaner solution: fix V007 directly)

**Corrections Made:**
  1. ✅ Deleted original V007 (no schema_migrations registration)
  2. ✅ Created corrected V007 with:
     - All original features (error_context, triggers, constraints, views, procedures)
     - INSERT INTO schema_migrations at end (proper registration)
     - SET FOREIGN_KEY_CHECKS = 0/1 (safe for re-runs)
     - ON DUPLICATE KEY UPDATE (idempotent)
  3. ✅ Deleted V008 (no longer needed - V007 now handles it)

**Live Features (Ready to Deploy):**
- error_context table: 19 columns for comprehensive error tracking
- 3 validation triggers: Auto-log violations on INSERT (submissions, members, payments)
- 9 CHECK constraints: Status, Amount, Email, PaymentDate validation
- v_unresolved_errors view: Priority-ranked error monitoring
- sp_error_summary_report(days): Error trend analysis
- activity_log enhanced: ErrorContext, ErrorSeverity, StackTrace fields
- ✅ Properly registered in schema_migrations table

**Cleanup:**
  ✅ Deleted V007A, V007B (temporary helpers)
  ✅ Deleted V008 (superseded by corrected V007)

**Next:** Push corrected V007 to main - GitHub Actions will auto-register in schema_migrations
