# Context Archive

## Archived Sessions (April 4, 2026)

### 04-04 07:24 UTC — Updated Admin Portal Sync Tab: New export endpoints + removed old actions

**Changed:** **mmr-admin/templates/index.html** — Updated MySQL→Google section with new `/api/sync/export/{members,submissions,payments}` endpoints (modern, write to SQL_* tabs).

**Status:** ✅ Admin Portal calls correct endpoints. Ready to test export buttons.

### 04-04 07:18 UTC — Fix: MySQL→Sheets export routes using wrong sheet names

**Changed:** **basecamp/python/sync_config.py** + **mmr-admin/sync_config.py** — Fixed sheet names: `'Main'` → `'SQL Members'`, `'Payment-History'` → `'SQL Payments'`, `'Submissions'` → `'SQL Submissions'`.

**Status:** ✅ Export routes now append to correct SQL_* sheets.

### 04-04 07:12 UTC — Fix: gmail_transactions INSERT parameter mismatch

**Changed:** **mmr-admin/api_sheets_sync.py** line 1446 — Fixed INSERT VALUES clause (12 placeholders → 10 correct placeholders).

**Status:** ✅ Import route ready for retry.

### 04-04 06:45 UTC — Phase 2: Admin Payment Workflow Updates (webapp_events → submissions)

**Changed:** 7 files updated (payment_actions.py, api_payments.py, api_sheets_sync.py, sync_engine.py, api_audit.py, api_data.py, backfill_unix_timestamps.py) — All queries migrated from webapp_events to submissions table. Status enum: 'matched' → 'approved', 'rejected' → 'cancelled'.

**Status:** ✅ 21 references replaced. All files compile. Ready for testing payment approval workflow.

### 04-04 05:10 UTC — V008: Drop webapp_events + Consolidate admin tables + Remove legacy sync tables

**Changed:**
1. **MIGRATION_V008_drop_webapp_events_consolidate_admins.sql** (CREATED) — Drop webapp_events, sync_changes, sync_snapshots, sync_metadata. Rename admins → admin_users. Merge viewer_admins into admin_users + add role column.
2. **webapp payment/donation routes updated** — webapp_events → submissions
3. **mmr-admin auth + admin endpoints updated** — All admin CRUD ops use admin_users
4. **mmr-webapp NextAuth admin checks updated** — lib/db/admins.ts queries admin_users

**Status:** ✅ V008 migration is idempotent. All code compiles. Single source of truth: admin_users. webapp_events removed. Ready to execute.

### 04-03 22:30 UTC — GAS webhook handlers for MySQL→Sheets write

**Changed:**
1. web-apps/gas/membership/src/config.ts — Added SQL_MEMBERS, SQL_PAYMENTS, SQL_SUBMISSIONS
2. web-apps/gas/membership/src/webhook.ts — Added handleWriteRange() + handleReadRange() handlers

**Status:** ✅ TypeScript compiles. Generic sync_runner can now call GAS webhook with write_range/read_range actions.

### 04-03 22:20 UTC — Add insert-only import_members sync mode

**Changed:**
1. Added import_members config: Sheets→MySQL, Main sheet, mode=insert_only (INSERT IGNORE)
2. Updated generic_sync_runner: Supports both upsert and insert_only modes
3. Added sync_import_members() wrapper + POST /api/sync/import/members route
4. Synced basecamp/python/sync_config.py → mmr-admin/sync_config.py

**Status:** ✅ 6 total configs (4 export + 2 import). All routes compile. Ready to register blueprint in app.py.

### 04-04 04:20 UTC — V007 Final: Idempotent + Removed CURDATE() from CHECK constraint

**Status:** ✅ V007 IDEMPOTENT + SAFE TO RE-RUN

**Changes:**
- V007 now uses INFORMATION_SCHEMA checks before each ALTER TABLE (skip if column already exists)
- Removed chk_submissions_payment_date_reasonable constraint (CURDATE() not allowed in CHECK constraints)
- Moved date validation to application code

**Live Features:** error_context table ✓, 3 validation triggers ✓, 8 CHECK constraints ✓, views ✓, procedures ✓, activity_log enhanced ✓

**Status:** ✅ V007 READY FOR PRODUCTION
