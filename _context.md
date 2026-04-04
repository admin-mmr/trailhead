### 04-04 07:18 UTC — Fix: MySQL→Sheets export routes using wrong sheet names

**Changed:**
- **mmr-admin/sync_config.py** lines 63, 77, 89: Updated sheet names for exports
  - export_members: `'Main'` → `'SQL Members'`
  - export_payments: `'Payment-History'` → `'SQL Payments'`
  - export_submissions: `'Submissions'` → `'SQL Submissions'`
- **basecamp/python/sync_config.py** lines 63, 77, 89: Same fixes (source of truth)
- GAS webhook handleWriteRange correctly appends to target sheets (no changes needed)

**Root Cause:**
- API routes `/api/sync/export/{members,payments,submissions}` were appending data to old sheet names
- Should write to SQL_* destination tabs (created in Apr 3 update) for MySQL→Sheets sync
- Old sheets (Main, Payment-History, Submissions) are for Sheets→MySQL import direction

**Status:**
- ✅ Both sync_config files updated
- ✅ File syntax verified
- Ready: Re-run `/api/sync/export/members`, `/api/sync/export/payments`, `/api/sync/export/submissions`
- Data will now append to correct `SQL Members`, `SQL Payments`, `SQL Submissions` tabs

**Next:**
- Test export routes to verify data lands in SQL_* sheets
- Verify append behavior (each run adds new rows, not overwrites)
- Monitor GAS webhook logs for successful write_range calls

### 04-04 07:12 UTC — Fix: gmail_transactions INSERT parameter mismatch

**Changed:**
- **mmr-admin/api_sheets_sync.py** line 1446: Fixed INSERT VALUES clause
  - Had 12 placeholders (`%s`), 10 columns → Now has correct 10 placeholders
  - Error: "Not enough parameters for the SQL statement" (12 params expected, 10 provided)
  - All 5 transaction rows from import now will succeed

**Status:**
- ✅ File syntax verified
- ✅ Import route ready for retry: `/api/sync/import/transactions`
- Ready: Re-run import to process Ming Jin, Frank Ko, Wayne, Julia Xiaoyan Fan, Rui Zhang rows

**Next:**
- Re-run `/api/sync/import/transactions` to insert these 5 rows
- Verify gmail_transactions populated correctly
- Check payment matching workflow for these new transactions

### 04-04 06:45 UTC — Phase 2: Admin Payment Workflow Updates (webapp_events → submissions)

**Changed:**
1. **mmr-admin/payment_actions.py** ✅
   - find_gmail_match(): event → submission, EventID → SubmissionID, Timestamp → CreatedAt
   - run_auto_match(): Query submissions instead of webapp_events, use Status='approved' instead of 'matched'
   - approve_event(): Query/update submissions, removed EventCategory filter
   - reject_event(): Update to Status='cancelled' (not 'rejected')
   - manual_match(): Query submissions, Status='approved'
   - admin_create_payment(): Insert into submissions with correct columns

2. **mmr-admin/api_payments.py** ✅
   - All queries: webapp_events → submissions
   - All filters: EventID → SubmissionID
   - All responses: Return submissionId instead of eventId

3. **mmr-admin/api_sheets_sync.py** ✅
   - Sync specs: webapp_events → submissions
   - Column mappings updated: EventID → SubmissionID, EventType → SubmissionType

4. **mmr-admin/sync_engine.py** ✅
   - Spec references: webapp_events → submissions
   - Column references: EventID → SubmissionID, EventType → SubmissionType

5. **mmr-admin/api_audit.py** ✅
   - Trace logic: webapp_events → submissions
   - Column references updated

6. **mmr-admin/api_data.py** ✅
   - Backfill queries: webapp_events → submissions
   - Timestamp column references updated

7. **mmr-admin/backfill_unix_timestamps.py** ✅
   - Backfill function: webapp_events → submissions
   - Status checks: pending → approved → expired workflow

**Status:**
- ✅ 7 files updated
- ✅ All Python files compile successfully
- ✅ 21 references to webapp_events/EventID replaced
- ✅ Status enum updated: 'matched' → 'approved', 'rejected' → 'cancelled'
- Ready for testing: Admin payment approval workflow

**Next:**
- Test admin auto-match flow (pending submissions → matched payments)
- Test manual match (link submission to gmail transaction)
- Test reject/cancel submission
- Test admin-create payment (for unmatched gmail rows)
- Verify payment fulfillment still works (member status updates, emails, Sheets sync)

### 04-04 05:10 UTC — V008: Drop webapp_events + Consolidate admin tables + Remove legacy sync tables

**Changed:**
1. **MIGRATION_V008_drop_webapp_events_consolidate_admins.sql** (CREATED) ✅
   - Drop webapp_events table (replaced by submissions)
   - Drop sync_changes, sync_snapshots, sync_metadata (legacy, unused)
   - Keep sync_jobs table (actively used for job tracking)
   - Rename admins → admin_users + merge viewer_admins into it
   - Add role column (enum: 'admin', 'super_admin') + updated_at
   - Add indexes on submissions (Status, ExpiresAt) for query optimization

2. **webapp payment/donation routes updated** ✅
   - /api/payments/submit: webapp_events → submissions (use SubmissionID instead of EventID)
   - /api/payments/pending: Query submissions instead of webapp_events
   - /api/payments/proof: Update table + field names for submissions
   - /api/donations/submit: webapp_events → submissions
   - No longer sync events to GAS (only members synced now)

3. **mmr-admin auth + admin endpoints updated** ✅
   - auth.py: get_user_role() queries admin_users instead of viewer_admins
   - api_admin.py: All admin CRUD operations use admin_users table
   - db.py: _init_viewer_admins_table() now just seeds super_admin in admin_users

4. **mmr-webapp NextAuth admin checks updated** ✅
   - lib/db/admins.ts: All queries use admin_users table
   - addAdmin() now accepts optional role param (default 'admin')
   - AdminRecord interface includes role field

**Status:**
- ✅ V008 migration is idempotent (uses INFORMATION_SCHEMA checks)
- ✅ All code changes compile + imports verified
- ✅ Single source of truth: admin_users replaces admins + viewer_admins
- ✅ webapp_events removed (submissions handles both memberships + donations now)
- ✅ Legacy sync tables removed (sync_jobs retained for active use)
- Ready to execute: Run MIGRATION_V008, then push code changes

**Next:**
- Execute MIGRATION_V008 on production
- Monitor admin auth in both mmr-admin + mmr-webapp
- Verify payment/donation flows work with submissions table
- Update frontend if eventId references change to submissionId

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

### 04-04 04:20 UTC — V007 Final: Idempotent + Removed CURDATE() from CHECK constraint

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

**Issue #2: CURDATE() in CHECK constraint (MySQL limitation)**
  - MySQL doesn't allow dynamic functions (CURDATE, NOW, etc.) in CHECK constraints
  - Error: "An expression of a check constraint contains disallowed function: curdate"
  - Solution: Removed chk_submissions_payment_date_reasonable constraint
  - Validation moved to application code (before INSERT, user input validation)

**Final Status: ✅ V007 READY FOR PRODUCTION**
  - All idempotent checks working
  - 8 CHECK constraints deployed (removed dynamic date constraint)
  - All other features working: error_context table, 3 triggers, views, procedures
  - Can be re-run safely without errors
