# Trailhead Project Context

Last updated: 2026-03-31 16:20 UTC
Last commit: 7b2491e (fix: replace get_db_connection() with get_conn() in all py_exec functions)

## Session log

### 2026-04-01 14:48 ET — Add member preview card to Quick Approve popover
Changed: `payments.js` GmailQuickApprovePopover — added memberData state + useEffect to fetch member details when valid ID entered; displays floating preview card with Name, Expiration, WeChatID. Shows loading state while fetching, updates real-time. Green left border card for visual clarity. Improves UX for validation + quick member reference. Committed b492410. Status: Ready.

### 2026-04-01 14:46 ET — Fix Quick Approve popover cutoff at screen edge
Changed: `payments.js` GmailQuickApprovePopover — added ref + useEffect to measure width after render; if extends beyond right edge (8px margin), switches from left-aligned to right-aligned. Added maxWidth (360px) constraint. Prevents popover cutoff on narrow/mobile screens. Committed 5ce5e92. Status: Ready.

### 2026-04-01 14:44 ET — Fix tooltip positioning at viewport boundaries
Changed: `payments.js` MemberTooltip component — now centers horizontally, constrains left/right edges (8px padding), detects insufficient space below (~160px), auto-repositions above anchor if needed. Prevents tooltips from overlapping screen boundaries. Committed 19b1ec9. Status: Ready.

### 2026-04-01 14:42 ET — Add 'Approve Selected' button for quick single-event approval
Changed: `payments.js` — added green "✓ Approve Selected" button (visible when single event selected). Clicking it opens manual match modal for that event, allowing user to select transaction + approve in one action. Renamed old batch button to "📋 Approve Pending (Batch)" for clarity. Improves UX for single-event manual approval workflows. Committed e13ee9e. Status: Ready. Next: Deploy + test button flow.

### 2026-04-01 14:40 ET — Add 10-second buffer to Sheets timestamps (async propagation delay)
Changed: `sync_engine.py` (both copies) — resolve_conflict() now subtracts 10 seconds from Sheets timestamp before comparing with MySQL. Accounts for GAS→Sheets API delay (~2-10s). Ties within 10s → MySQL wins (fresher data). Applied in ONE place only as single source of truth. Example: Sheets=T18:14:58, MySQL=T18:14:56 → adjusted Sheets=T18:14:48 → MySQL wins. Fixes: incomplete Sheets records blocking MySQL updates. Committed d3f07fc. Status: Import ✅. Next: Test that incomplete payments now get overwritten with complete MySQL records.

### 2026-04-01 14:37 ET — Reduce logging noise: skip tie-timestamp MATCH entries
Changed: `api_sheets_sync.py` MySQL→Sheets sync (members/events/payments): tie-timestamp entries with NO field diffs now silent (no log); only log SKIP when there ARE actual field differences. Shows which fields differ in log message. Removes noise from tie-only entries. Committed 3e11bbb. Status: Import ✅. Next: Expand approve & link to sync all 4 sheets (members, payments, events, gmail_transactions) not just events.

### 2026-04-01 14:35 ET — Auto-sync member events to Sheets after manual match
Changed: `api_payments.py` — added _sync_member_events_to_sheets() helper (fetches member's events, filters sync-eligible columns, posts GAS webhook 'update_events'); integrated into approve_event_match (non-blocking auto-sync after approval); added POST /api/payments/sync-member-to-sheets/{member_id} endpoint for manual sync. Uses filter_sync_columns + requests to match Sheets schema. Committed 042af9a. Status: Import check ✅. Next: Deploy + test manual match approval triggers Sheets update.

### 2026-04-01 14:32 ET — Add manual event-to-transaction matcher popup
Changed: Created ManualEventMatchModal.js (React component) + backend endpoints in api_payments.py. Feature: admin clicks "📋 Approve Pending" button in Payments tab → modal shows pending events (left) + 3-tier match suggestions (right): most likely (amount+memberID), more likely (name match), recently matched (date±2 days). Admin selects transaction row + optional notes → confirms → updates webapp_events (MatchedMessageId, MatchedTransactionNumber, AdminApprover, ApprovalDate, PaymentDate, Notes, Status='approved'). Resolves: pending events left hanging after autoguess. Committed 472a356. Status: Import check ✅ passed. Next: Deploy + test on live pending events.

### 2026-04-01 14:26 ET — Fix tie-timestamp MATCH/SKIP logic
Changed: `api_sheets_sync.py` — Members/Events/Payments SHEETS_WINS handling: when timestamp tie, now check for actual field diffs before logging. If no field differences (identical data) → log `= MATCH (tie: ...)` instead of `⏭️ SKIP`. If field diffs exist → log `⏭️ SKIP` (Sheets will apply on nightly sync). Prevents false SKIP entries. Committed ff7ff19. Status: Import check ✅ passed. Next: Deploy + test sync output on live data.

### 2026-04-01 14:24 ET — Commit date/time refactor; plan GAS deploy + webhook fix
Changed: Committed `a494acb` — all 8 date/time refactor files (GAS sheets.ts/jobs.ts/webhook.ts, Python datetime_utils.py, webapp lib/date.ts/auth/complete/DashboardClient.tsx). Import check ✅ passed. Status: Ready for GAS clasp deploy + webapp build verify. Next: (1) Deploy GAS (clasp push + redeploy); (2) Re-set SheetsWebhookUrl in MySQL config (was stale 404); (3) Run webapp `npm run build`; (4) Re-run import transaction batch to verify end-to-end flow.

### 2026-04-01 13:49 ET — Date/time refactor across all three layers
Changed: (GAS) `sheets.ts` — added canonical `toISODateString()` (local date extraction, no UTC shift); fixed `deriveStatus`, `rowToMember.expiration+paymentDate`, `rowToFetchGmailRow.transactionDate`; removed buggy UTC-shifted version from `jobs.ts`; fixed `rowToMemberObject` + `rowToEventObject` in `webhook.ts` to use `toISO8601`/`toISODateString` correctly. (Python) `datetime_utils.py` — `to_datetime` now strips tzinfo (UTC normalize); `to_date` handles ISO strings directly. (webapp) `lib/date.ts` — added `parseLocalDate`, `isExpiredNY`, `daysUntilExpiryNY`, fixed `formatLocaleDate` for YYYY-MM-DD inputs; `auth/complete/route.ts` + `DashboardClient.tsx` use NY-aware helpers. Status: import check passes; GAS needs clasp deploy + redeploy; webapp needs `npm run build` verify. Next: deploy GAS, fix stale SheetsWebhookUrl, re-run import.

### 2026-04-01 13:21 ET — Fix Bugs 2/3/4: gmail_transactions import + ProcessedTime lifecycle
Changed: (Bug 2) `_import_transactions` INSERT now captures all 13 fields (Sender, Amount, TransactionDate, TransactionNumber, Subject, OriginalMemo, Source) + backfill UPDATE for existing NULL rows; `sheets_row_for_engine` now passes Sheets PaymentID/Source for engine use. (Bug 4) Removed `ProcessedTime=NOW()` from `run_auto_match` + `manual_match`; added it to `approve_event` after actual approval (with `AND ProcessedTime IS NULL` guard). (Bug 3) `sync_engine.py:resolve_gmail_row` now syncs ProcessedTime/Source/PaymentID Sheets→MySQL when GAS has processed a row (MySQL NULL). Status: all three fixed; 404 error on import is a stale SheetsWebhookUrl — user must redeploy GAS and update config. Next: redeploy GAS webhook, update SheetsWebhookUrl in MySQL config, re-run import.

### 2026-04-01 12:56 ET — Full mmr-admin refactor: shared utilities + wiring
Changed: Created `core.py` (gen_id, fixes collision bug), `config_cache.py` (thread-safe, replaces 5 get_config impls), `activity_logger.py` (replaces 3 duplicate INSERT blocks), `sync_jobs.py` (replaces _sync_jobs/_sync_jobs_lock/10 thread dispatches in api_sheets_sync.py), `query_builder.py` (add_search/add_date_filter), `datetime_utils.py` (to_datetime/to_date). Added `@handle_api_errors` to `helpers.py`. Wired all into payment_handlers, payment_actions, api_payments, api_sheets_sync, sheets_sync, webhook_client, api_sheets_diags. Created `static/utils.js` (fmt/fmtDate/fmtMoney/STATUS_COLORS/Badge/api). Updated DistrictMembersPanel.js to use mmrUtils.api(). Status: test_imports passes (7 pure-python modules ✅, 29 skipped for missing deps). Next: deploy + smoke test; fix Bug2 (Amount NULL in gmail_transactions import).

### 2026-04-01 11:29 ET — Standardize sync log format + fix SKIPPED→MATCH
Changed: `api_sheets_sync.py` — all 6 sync paths (Sheets→MySQL + MySQL→Sheets × members/events/payments) now emit `✅ INSERT | 🔄 UPDATE | = MATCH | ⏭️ SKIP | ❌ ERROR` per-row lines with key, MemberID, changed fields, and timestamps. SKIPPED (Sheets ts newer, no field changes) now writes MySQL `LastUpdated` to match Sheets and logs as `= MATCH` so next run is clean. Status: syntax verified. Next: deploy + run sync to confirm log output.

### 2026-04-01 09:56 ET — Rebuild gmail_transactions: WebAppID → PaymentID
Changed: Renamed `WebAppID` → `PaymentID` in gmail_transactions (schema_snapshot.sql + 6 Python files: api_sheets_sync.py, payment_actions.py, api_email_diags.py, sync_engine.py x2, auto_guess_payments.py). Status: DROP/CREATE SQL ready (see below); user runs SQL + Sheets→MySQL sync to repopulate clean data. Next: Run SQL, sync, commit all changes.

### 2026-04-01 09:15 ET — Sprint 1: bug fixes, db pooling, test suite
Changed: (1) Fixed G→MySQL Status 1265 bug — added `_coerce_member_status()` + `_MEMBER_STATUS_MAP` mapping GAS 'inactive'→'not active', 'pending_upgrade'→'pending', case variants → lowercase; (2) Fixed G→MySQL MatchedMessageId 1452 bug — empty string `''` now nulled out (was falsy, bypassed FK guard); (3) `db.py` — replaced per-query fresh connections with `MySQLConnectionPool(pool_size=5)`, added `db_cursor()` context manager (auto commit/rollback), added `handle_mysql_error()` mapping errno→HTTP status; (4) Deleted 4 dead files (api_sync_old.py, google_workspace.py, mysql_sync.py, db/schemas/members.sql); (5) Created `tests/` with conftest.py + 62 passing unit tests (test_db.py, test_sync_status.py, test_sync_coerce.py); added pytest to requirements.txt. Status: All 62 tests pass. Next: Add pytest to pre-commit hook; commit + push.

### 2026-04-01 08:10 ET — Full codebase audit report
Changed: Created `CODEBASE_AUDIT.md` (611 lines) — architecture review, MySQL pain point analysis (no pooling + inconsistent error handling + zero tests), 7 exact duplicates mapped, 13 oversized files flagged, 5-sprint reorganization roadmap, testing pyramid proposal, 8 stale docs identified. Status: Report complete. Next: Execute Sprint 1 (connection pooling, db_cursor context manager, pytest setup, delete dead files).

### 2026-04-01 07:48 ET — delete redundant sync-all-sheets-ordered workflow
Changed: Deleted `.github/workflows/sync-all-sheets-ordered.yml` (replaced by bidirectional-sync). Status: Done. Next: Push deletion commit.

### 2026-04-01 07:29 ET — improve sync logging and G→M summary format
Changed: MySQL→Google events log now shows `field: old → new` per diff; G→M summary includes skipped+errors per table; `errors_members` tracked separately. Status: Done. Next: Push all commits to deploy.

### 2026-04-01 01:50 ET — fix 3 Google→MySQL sync errors (decimal, FK events, FK payments)
Changed: `_coerce_value` now handles decimal/float cols (`''`→None); members block fetches decimal cols from schema; events block NULLs orphan `MatchedMessageId` vs `gmail_transactions`; payments block NULLs orphan `EventID` vs `webapp_events`. Status: Done. Next: Deploy and re-run sync to verify.

### 2026-04-01 01:32 ET — add pre-deploy import validation to CI
Changed: Added Python 3.11 setup + `pip install -r requirements.txt && python3 test_imports.py` step to `deploy-mmr-admin.yml` before deploy. Status: Done — next push will validate all imports with full deps before reaching Azure. Next: monitor first CI run.

### 2026-04-01 01:29 ET — fix sync_engine ModuleNotFoundError on Azure
Changed: Copied `basecamp/python/sync_engine.py` → `mmr-admin/sync_engine.py`; removed `sys.path.insert` hack in `api_sheets_sync.py`. Status: Fixed — `test_imports.py` passes. Next: Commit both files; monitor Azure restart.

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

### 2026-04-01 01:08 ET — Full bidirectional sync + UI symmetry
Changed: Flattened `GoogleToMySQLPanel` to match MySQL→Google style (3 primary buttons, no inner tabs, no dry-run). Added `Full Sync` sub-tab to `SyncPanel` with 8-phase list + button. Added `_run_full_bidirectional_sync()` orchestrator + `_cron_auth_or_session` decorator + `/api/sync/full-bidirectional-sync` route to `api_sheets_sync.py`. Created `.github/workflows/bidirectional-sync.yml` — 8 chained jobs (cron 4×/day), each polls `/api/sync/status/{id}` via `X-Cron-Token` auth, final notify job emails admin@mmrunners.org. Fixed `errors_count` asymmetry in `JobCard`. Status: needs 2 new GH Secrets (`MMR_ADMIN_URL`, `SYNC_CRON_TOKEN`) and `SYNC_CRON_TOKEN` set in Azure app settings. Next: push + set secrets.

### 2026-04-01 00:55 ET — G→MySQL type coercion + UI fixes
Changed: Added `_coerce_value()` to `api_sheets_sync.py` — detects INT/YEAR columns via INFORMATION_SCHEMA and converts `''`→`None`, fixing 1366 errors on `JoinYear` (members, events, payments). Added per-row `log_lines` error output for events + payments. Normalised G→MySQL result shape to add top-level `inserted/updated/skipped/errors_count`. Added `/api/sync/jobs` list endpoint + `SyncPanel` mounts from it (jobs persist across tab switches/page reload). Rewrote `JobCard` to show `result.error` prominently + stat line. Removed duplicate `RecentJobs` from `GoogleToMySQLPanel`; added `filterFn` prop so each sub-tab shows only its own jobs. Updated description copy to reflect bidirectional sync. Status: committed locally, needs push. Next: verify G→MySQL members/events/payments run clean.

### 2026-04-01 00:34 ET — Bidirectional sync engine (shared module)
Changed: Created `basecamp/python/sync_engine.py` (598 lines) — canonical spec-compliant bidirectional logic shared by cron job and admin portal. Fixes: GMT offset discarded instead of applied to UTC, tie-breaker not implemented (Sheets wins), missing-timestamp edge cases skipped instead of resolved. Updated `basecamp/ops/sync_sheets_to_mysql.py` and `mmr-admin/api_sheets_sync.py` to import from engine. Status: all 6 conflict-resolution test cases pass. Next: commit + run `nyrr-test` to verify import chain.

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

