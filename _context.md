# Trailhead Project Context

Last updated: 2026-03-31 16:20 UTC
Last commit: 7b2491e (fix: replace get_db_connection() with get_conn() in all py_exec functions)

## ⏭️ Next Session — Pending Tasks

DEDUPLICATION & TECH DEBT TARGETS:
1. Python API Clients: Consolidate basecamp/python/nyrr_api.py vs mmr-admin/nyrr_api.py.
2. DB Schemas/Migrations: Merge basecamp/schemas/ vs db/schemas/ and basecamp/migrations/ vs db/migrations/.
3. Sheets Sync Scripts: Deduplicate api_sheets_sync_batched.py, api_sheets_sync.py, and mmr-admin/api_sheets_sync.py.
4. Docs/Scripts: Clean up duplicate LOCAL_SETUP.md and orphaned .sh scripts at root.
5. Column Mapping: Unify Google Sheets ↔ MySQL column name mapping (camelCase vs PascalCase).
6. Datetime Handling: Standardize timestamp/datetime conversion logic across sync scripts.
7. Triggers & GH Actions: Reconcile Admin portal manual buttons vs GitHub Actions scheduled jobs.
8. Email Webhooks: Consolidate email sending via GAS webhook (including user copies and GH scheduled jobs).

PORTAL LAUNCH PREP (Carryover):
1. GOOGLE OAUTH TEST (local)
2. EMAIL/PASSWORD TEST (local)
3. FIRST-TIME SETUP TEST
4. EXPIRED MEMBER TEST
5. RUN MIGRATION V9 ON PRODUCTION
6. PUSH TO TRIGGER AZURE DEPLOY

---

## Session log

### 2026-04-01 00:03 ET — Remove page_admin from GAS membership app
Changed: Deleted frontend/page_admin.html and dist/page_admin.html; removed 'admin' from allowedPages in ui.ts; removed Admin Panel button + JS from page_dashboard.html; removed admin approval deep-link from page_payment_history.html. Status: done, needs push + clasp deploy. Next: —

### 2026-03-31 23:52 ET — Sync tab follow-up fixes (5 issues)
Changed: Removed per-row skip logs from MySQL→Google Members/Events/Payments (count only in summary). Fixed Events mass-updates: missing UpdatedAt on either side now skips (was forcing update). Fixed Payments: same missing-date trigger, now uses _parse_datetime comparison. Fixed Sync Unprocessed Txns DATETIME error: removed `OR ProcessedTime = ''` from query (MySQL rejects empty string for DATETIME). Fixed Google→MySQL datetime normalization: now uses INFORMATION_SCHEMA to detect actual datetime columns instead of name-guessing (was missing `Created`, etc.). Status: committed, needs push. Next: verify G2M per-table routes work after datetime fixes.

### 2026-03-31 23:33 ET — Sync tab bug fixes (4 issues)
Changed: Unified JobCard component with job name + action type header + View Log toggle across all Sync sub-tabs. Fixed Import Transactions Notes='' on INSERT (now Notes=Memo, preventing double-update on re-run). Fixed `RuntimeError: Working outside of request context` in `_sync_unprocessed_transactions_to_sheets` (removed erroneous `@route`/`@login_required` from thread-target function). Added per-table Google→MySQL routes + sub-tabs (Members/Events/Payments); `_sync_google_to_mysql` and `_dry_run_google_to_mysql` now accept `tables` filter param. Status: deployed to repo, needs Azure push. Next: push to Azure, verify per-table G2M routes work end-to-end.

### 2026-03-31 23:15 ET — Regenerate schema_snapshot.sql from live DB
Changed: Overwrote db/schema_snapshot.sql with live DDL from dump_schema() (18 tables); updated table_groups.json to add admins, viewer_admins, viewer_user_settings. Status: Done. Next: Prune db/schemas/ deprecated reference files.

### 2026-03-31 23:05 ET — SQL consolidation, schema tools, Email Log headers
Changed: Deleted duplicate SQL files (web-apps/mmr-webapp/db/mmr_db_inspector.sql, basecamp/ops/mmr_migration_consolidated.sql); moved v1–v10 archive + check_event_data.sql into db/; added table_groups.json to mmr-admin; added dump_schema() to api_python_exec.py; fixed activity_log query in api_email_diags.py (Details → State/ErrorCode/ErrorMessage); updated db/README.md with schema tools and corrected layout. Status: Done. Next: Run dump_schema() in Python Exec tab to regenerate db/schema_snapshot.sql from live DB, then prune db/schemas/.

### 2026-03-31 22:35 UTC — Repo cleanup: remove orphaned sync scripts & duplicate schemas
Removed 6 orphaned root-level sync scripts (sync_*.sh) and 2 sheets sync duplicates (api_sheets_sync*.py) via `git rm`. Deleted basecamp/schemas/ and basecamp/migrations/ (db/ is canonical). Updated .gitignore to prevent re-commit. Verified mmr-admin/app.py has nyrr_api.py path setup for local dev. Status: Complete — clean single-source-of-truth for schemas, migrations, and sync logic.

### 2026-04-01 00:24 UTC — Deduplication & Technical Debt Planning
- Changed: Updated Pending Tasks with duplicate logic targets (schemas, API clients, mappings, datetimes, webhooks).
- Status: Planned.
- Next: Begin codebase deduplication.
### 2026-03-31 21:25 UTC — Create _to_iso_datetime() wrapper for datetime normalization
Root cause of "Incorrect datetime value" error: GAS webhook returns JavaScript Date.toString() format ('Tue Mar 31 2026 15:51:18 GMT-0400 (...)') but MySQL expects ISO 8601 ('2026-03-31 15:51:18'). Created `_to_iso_datetime()` wrapper function as single source of truth for all datetime normalization. Handles JavaScript Date.toString(), ISO 8601, datetime objects, and date strings. Applied to transaction import: normalize timestamp_raw and processed_time_raw before INSERT. Enhanced logging shows both raw and normalized values. Reusable across all four tables. Committed cd50f80. Status: Complete.

### 2026-03-31 21:18 UTC — Add missing TimeStamp field to gmail_transactions INSERT
Schema requires `TimeStamp DATETIME NOT NULL` with no default value. GAS webhook provides timestamp in 'timestamp' field (normalized to 'Timestamp'). Updated INSERT to: (1) extract timestamp from row; (2) validate it's not missing; (3) include TimeStamp in 6-column INSERT (was 5). Fixes "Field 'TimeStamp' doesn't have a default value" errors. Committed d82d75b. Status: Complete.

