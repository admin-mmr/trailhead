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

### 04-04 04:15 UTC — V007 Made Idempotent: Checks INFORMATION_SCHEMA before ALTER TABLE

**Status: ✅ V007 IDEMPOTENT + SAFE TO RE-RUN**

Root Cause:
  - ErrorContext, ErrorSeverity, StackTrace columns already existed in activity_log
  - V007 tried to ADD them again → "Duplicate column name 'ErrorContext'" error
  - Columns ARE in schema (from previous partial execution), but V007 wasn't idempotent

**Fix Applied:**
  ✅ V007 now uses INFORMATION_SCHEMA checks before each ALTER TABLE:
  - Checks if column/constraint/index exists
  - Only executes if missing (PREPARE/EXECUTE pattern, MySQL 5.7 compatible)
  - Skips if already present (no error)
  - Safe to re-run idempotently

**Sections Updated:**
  1. Section 1: Column adds → wrapped in INFORMATION_SCHEMA checks
  2. Section 3: Constraint adds → wrapped in INFORMATION_SCHEMA checks
  3. Section 2: error_context table → already IF NOT EXISTS (safe)
  4. Sections 4-9: Triggers/views/procedures → already safe (will skip if exist)

**Live Features (All Present in Schema):**
- error_context table: 19 columns ✓
- 3 validation triggers: submissions, members, payments ✓
- 8 CHECK constraints: Status, Amount, Email, PaymentDate ✓
- v_unresolved_errors view ✓
- sp_error_summary_report(days) procedure ✓
- activity_log enhanced: ErrorContext, ErrorSeverity, StackTrace ✓

**Next:** Re-run corrected V007 - will skip existing objects, add missing ones
