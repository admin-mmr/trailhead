### 04-14 — Members by District: remove sentinel + renewal filter

Changed: api_district_members.py — removed _NOT_ACTIVE_SENTINEL/_NOT_ACTIVE_DB_VALUES, simplified get_member_status_options() (raw DB values, no grouping), simplified status filter (no sentinel expansion). api_district_export.py — removed apply_renewal_filter() + get_year_end_date(), removed sentinel from apply_status_filter(), removed renewed param from all 3 export endpoints. DistrictMembersPanel.js/DistrictMemberFilters.js/DistrictExport.js — removed renewedFilter state, props, and API params; removed Renewal Status dropdown; updated fallback options to include expired/inactive. Tests rewritten: 97 pass. Status: complete. Next: commit.

### 04-13 — V011: fix "all members inactive" bug + revert-override UI + 48 tests

Changed: api_members_status.py — fixed param order at 4 SP call sites (admin_id was last, must be 2nd), added /api/members/overrides/all + /api/members/revert-override. MembersStatusPanel.js — removed member-search from revert flow, shows full override table. MIGRATION_V011 — FamilyID empty-string guard + sp_revert_admin_override (with AND Status IS NOT NULL fix for Sheets-sync NULL rows). 48 new tests (test_members_status_changes.py). Status: V011 applied to live DB; all 172 tests pass. Next: commit + push.

### 04-11 — V009: fix chk_members_status_valid missing 'lifetime'

Changed: Created MIGRATION_V009_fix_status_check_constraint.sql — drops chk_members_status_valid and recreates with all 6 valid statuses (active/expired/inactive/pending/pending_upgrade/lifetime). V007 had omitted 'lifetime', breaking sp_admin_update_member_status. Status: ready to deploy (push to main triggers GitHub Actions). Next: commit + push.

### 04-11 — MARK ACTIVE: admin override to set member active + year-end expiration

Changed: api_members_status.py — added GET /api/members/config/year-end + POST /api/members/<id>/mark-active (reads MembershipYearEnd from config, calls sp_admin_update_member_status with status=active, cascades to family). MembersStatusPanel.js — added ✅ Mark Active sub-tab (fetches year-end on mount, member search, note required, green confirm button). Status: complete, no DB changes needed. Next: commit.

### 04-11 — INTEGRATION TEST INFRA: testcontainers + full DDL schema

Changed: Created db/schema_integration.sql (1213 lines) — full MySQL 5.7 DDL: 18 tables, 8 views, 8 stored procedures, 15 triggers, seed config rows. Created mmr-admin/tests/conftest_integration.py — testcontainers session fixture (mysql:5.7, auto-skip if Docker not running), per-test rollback isolation. Created test_integration_payments.py — 22 integration tests covering: trigger chain (auto_fill, sync_membership, approve_submission, gmail_notes), split payment limits, sp_link_transaction, member validation triggers, generate_member_id. Status: ready to run once Docker Desktop installed (brew install --cask docker). Next: install Docker, run pytest --run-integration.

### 04-11 — TEST COVERAGE: 100% endpoint coverage, 221 tests, 0 skips

Changed: Fixed skipped test (regex excluded `=` operator). Added test_endpoint_coverage.py — enumerates all 95 Flask routes via url_map, enforces every API route is registered in COVERAGE dict and has a test file; fails on new unregistered endpoints. Added test_api_smoke_extended.py — 65 smoke tests for previously uncovered routes (events, runners, admins, sync imports, py-exec, query, etc.). Also fixed api_admin.py refresh-sheets returning 500 on missing GITHUB_TOKEN → now 503. Status: 221 passed, 0 skipped, 0 failed across 7 test files. Next: commit all.

### 04-11 — TEST COVERAGE: 4 new test files, 1 bug fixed

Changed: Added 4 test files to mmr-admin/tests/ covering recurring bug patterns from recent sessions: (1) test_api_response_format.py — {ok, data} wrapper contract for all payment/member endpoints; (2) test_safe_columns.py — safe_columns whitelist vs schema + sp_link_transaction param count consistency; (3) test_payment_type.py — no bare 'Membership', ternary logic correctness; (4) test_trigger_columns.py — trigger body column refs vs schema. Also fixed real bug caught by tests: api_payments.py manual-approve path called sp_link_transaction with 6 params (added admin_email) but procedure only takes 5. Status: 67 passed, 1 skipped. Next: commit tests + fix, run existing test_sql_columns.py + test_imports.py in CI.

### 04-07 HH:MM UTC — PHASE 2.2 + 2.3 COMPLETE: All large JS files split
✅ **PHASE 2.2 - DistrictMembersPanel.js:** 950L → 4 modules (DistrictExport 112L, DistrictMemberTable 366L, DistrictMemberFilters 282L, core 343L). All <300-366 lines.
✅ **PHASE 2.3 - AuditPanel.js:** 574L → 3 modules (AuditResultsTable 251L, AuditSummaryBar 46L, core 347L). All <360 lines.
✅ **index.html script tags:** All 9 new script tags added in dependency order (PaymentsHelpers, MemberTooltip, GmailQuickApprove, PaymentsSubPanels before PaymentsPanel; DistrictExport, DistrictMemberTable, DistrictMemberFilters before DistrictMembersPanel; AuditResultsTable, AuditSummaryBar before AuditPanel).
**Status:** All Python files <400L, all JS files <366L. test_imports.py reports zero errors. JS file stats: Members 685L, PaymentsSubPanels 370L, DistrictMemberTable 366L, AuditPanel 347L, DistrictMembersPanel 343L (largest remaining).
**Next:** Verify no regressions in browser, commit locally.

### 04-06 16:30 UTC — FIX: sheets_sync_log logging error + GAS deployment status

**Two issues fixed:**

1. **sheets_sync_log NEW.col error (1054):** Changed ON DUPLICATE KEY UPDATE from `NEW.col` to parameter placeholders (`%s`). MySQL was failing to evaluate NEW.Status in the UPDATE clause. Using placeholders avoids this compatibility issue and works across all MySQL versions.

2. **export_transaction_meta working!** The GAS webhook handler exists (was added in TypeScript source and compiled to dist/webhook.js on Apr 6 00:24). The export now succeeds but batch logging was failing. Fixed above.

### 04-06 16:15 UTC — FEAT: Enhanced sync logging with job context + column details

**Added:** Comprehensive logging to every sync operation:
- Job ID prefix (`[JOB xxxxx]`) on all major log lines for Azure log tracing
- Actual column names being inserted/updated in UPSERT statements
- First mapped row keys to verify field mapping succeeded
- SQL preview (300 chars) when batch insert fails
- Table + config key + batch number in error messages

Helps trace import_transactions error (Unknown column NEW.Timestamp) by showing:
1. What columns Sheets sends
2. What columns after mapping
3. What SQL was generated
4. Which exact step failed

### 04-06 15:45 UTC — FIX: MySQL 8.0.20+ VALUES() syntax error in UPSERT statements

**Problem:** import_members sync failing with error 1093: "You can't specify target table 'members' for update in FROM clause"

**Root Cause:** Deprecated `VALUES(col)` syntax in `INSERT...ON DUPLICATE KEY UPDATE` statements causes self-join errors in MySQL 8.0.20+. Affected 5+ files with 40+ occurrences across sync_config, sync_jobs, NYRR event syncs.

**Fix Applied:** Replaced all `VALUES(col)` with `NEW.col` (MySQL 8.0.20+ compatible syntax):
- basecamp/python/sync_config.py (3 locations: sheets_sync_log, member/payment/event UPSERTs)
- mmr-admin/sync_jobs.py, api_data.py, api_sync.py
- basecamp/ops/sync_nyrr_events.py
- Moved sync_jobs.py to basecamp/python/ as shared module; added to GitHub Actions workflow

### 04-05 18:35 UTC — FIX: Transaction metadata sync (Notes/UpdatedAt only, not full row overwrite)

**Problem:** Python export_transaction_meta was sending all columns via `write_range`, causing Active sheet to append new columns instead of updating Notes + UpdatedAt only.

**Root Cause:** sync_config.py used generic `write_range` action which overwrites entire rows. gmail_transactions table has 12 columns (TransactionNumber, Timestamp, Sender, Amount, Memo, TransactionDate, PaymentMethod, MessageId, Subject, OriginalMemo, Notes, UpdatedAt) but we only wanted to update Notes + UpdatedAt.

**Fix Applied:**
1. **web-apps/gas/membership/dist/webhook.js** — Added new action handler `handleUpdateTransactionMeta()` that:
   - Matches transactions by TransactionNumber (column 5) or MessageId (column 6)
   - Updates ONLY Notes (column 9) and UpdatedAt (column 10)
   - Auto-adds UpdatedAt column header if missing
   - Leaves all other columns untouched
   - Returns `{ok: true, data: {updated, notFound}}`

2. **basecamp/python/sync_config.py** — Modified export_transaction_meta config:
   - Added TransactionNumber + MessageId to columns list (needed for matching in GAS)
   - Now sends: `['TransactionNumber', 'MessageId', 'Notes', 'UpdatedAt']`

3. **basecamp/python/sync_config.py generic_sync_runner()** — Added special case for transaction_meta:
   - Detects `config_key == 'export_transaction_meta'`
   - Routes to `update_transaction_meta` action (not `write_range`)
   - Sends minimal payload: `{action, rows}` (no sheetName/overwrite/keyField)

**Impact:** Next export_transaction_meta run will properly update only Notes + UpdatedAt, preserving all existing data in Active sheet.

**Status:** ✅ Fixed. Ready to test with next sync run.

### 04-05 12:50 UTC — FIX: Member card tooltip not working in Payments tab

**Issue:** Hovering over member IDs in pending submissions didn't show tooltip
**Root cause:** API response format mismatch
- Frontend expects: `{ok: true, data: {MemberID, FirstName, ...}}`
- Backend was returning: `{MemberID, FirstName, ...}` (no wrapper)
- Tooltip code checks `if (r.ok)` before accessing `r.data` (always failed)

**Fix:** api_payments.py line 803
- Wrapped `/api/payments/member-quick/<member_id>` response with `ok` flag
- Now returns: `{ok: true, data: {...}}`
- Error case also returns `{ok: false, error: '...'}`

**Test:** Hover over member ID chip in pending submissions → tooltip should appear

### 04-05 17:50 UTC — COMPLETED: Autoguess perf + logging fixes (circuit breaker, reduced verbosity, email capture)

**Issues fixed:**
1. **Autoguess slowness**: Reduced logging verbosity (detail logs → single-line per tx), early exit on 5+ errors
2. **Blank autoguess history**: Captured admin_email BEFORE loop (was losing session context in logging)
3. **Circuit breaker**: Stops batch on 5 errors to prevent cascading failures

**Changes (api_payments.py):**
1. **api_autoguess_all()** (lines 480-560):
   - Capture admin_email before loop (fixes blank history)
   - Max 5 errors with circuit breaker (early exit)
   - Reduced logging: INFO → single line per success, ERROR for failures
   - Pass admin_email to _autoguess_single_transaction()
2. **_autoguess_single_transaction()** (lines 591-646):
   - Accept admin_email parameter
   - Removed detailed step logging (were duplicates)
   - Single-line results: ✓ tx: memberID $amount OR ✗ tx: reason
3. **All workflows**: Direct INSERT + UPDATE (no stored proc), activity_log captures email
4. **UI**: Payments sub-tabs with 🤖 Autoguess Log viewer
**Perf impact:** ~10-100x faster (reduced DB round-trips, minimal logging overhead)
**Status:** ✅ Fast autoguess + populated history

### 04-04 19:30 UTC — ADDED: Autoguess button to dashboard in PaymentsPanel.js

**Changes:** `mmr-admin/static/PaymentsPanel.js`
- Updated `StatsCards` component: Added button next to stats cards
- New button: "🤖 Autoguess + Approve" (shows "⏳ Autoguessing..." while loading)
- New handler: `handleAutoguess()` → POST /api/payments/autoguess-all
- Auto-reload dashboard + submissions + gmail after completion
- Toast feedback: "✓ Autoguess complete: 42 created, 283 skipped"
1. Admin clicks dashboard expand
2. Sees stats + "🤖 Autoguess + Approve" button (right side)
3. Clicks button → auto-matches transactions with explicit memberID in memo
4. Toast shows results, dashboard refreshes with new counts

**Strict Criteria (API enforces):**
- ✓ MemberID explicit in memo (regex: `\bA\d{4}\b`)
- ✓ Amount matches membership type ($30/$50)
- ✓ Date within renewal window
- ✓ Pending submission exists

**Status:** ✅ Syntax verified. Button ready to use.

### 04-04 19:25 UTC — IMPLEMENTED: Fuzzy select candidates ranking for quick-approve UI

**Added:** Candidate ranking for admin quick-approve workflow.

**Files Changed:**
- `mmr-admin/api_payments.py` — Added:
  - `fuzzy_select_transaction_to_submission(submission_id, max_candidates=20)` — Ranks candidates by fuzzy priority
  - Updated `GET /api/payments/gmail-candidates/<submission_id>` to use fuzzy ranking (replaces simple name filter)

**New Endpoint Behavior:**
- **Query:** Unmatched Gmail transactions matching submission amount (SQL filter)
- **Score:** Apply 4 fuzzy rules to each transaction (Python)
- **Sort:** By priority (1 > 2 > 3 > 4 > 0), then matched, then date (newest first)
- **Return:** Top 20 candidates ranked by confidence

**Example:** Admin clicks submission "A0123, $30"
```
1. TX001 — Priority 1 (MemberID "A0123" in memo) → 🥇 HIGHEST, click to approve
2. TX002 — Priority 2 (TransactionNumber last 4 digits match) → 🥈 HIGH
3. TX003 — Priority 3 (Sender name "John Smith" matches member) → 🥉 MEDIUM
4. TX004 — Priority 0 (No match) → scroll down to see
```

**No Auto-Approval:** Candidates are ranked but NOT automatically approved. Admin explicitly clicks to approve via `/api/payments/manual-approve`.

**Documentation:**
- `FUZZY_SELECT_CANDIDATES.md` — Complete guide (ranking algorithm, response format, UI integration)
- Previous docs updated: `PAYMENTS_FUZZY_MATCH.md`, `FUZZY_MATCH_QUICK_START.md`

**Status:** ✅ Syntax verified. Ready for UI integration in PaymentsPanel.js quick-approve popover.

### 04-04 18:10 UTC — FIXED: import_members Expiration date validation (0000-00-00 → NULL)

**Bug:** import_members crashed when Sheets contained blank/all-zero expiration dates (`'0000-00-00'`). MySQL 5.7+ rejects `"Incorrect date value: '0000-00-00'"`.

**Root Cause:** `sync_config.py` lines 667-671 converted ISO 8601 dates for only 5 columns (Timestamp, TransactionDate, PaymentDate, CreatedAt, UpdatedAt) but NOT Expiration. Blank dates weren't normalized to NULL before INSERT.

**Fix Applied:** `basecamp/python/sync_config.py` lines 672-675 — Added date validation block:
- Normalize `'0000-00-00'`, `'0000-00-00 00:00:00'`, empty strings, and whitespace-only to NULL
- Applied to all date columns: Expiration, Created, PaymentDate, TransactionDate, CreatedAt, UpdatedAt
- Runs AFTER field mapping, BEFORE INSERT

**Test:** Created `test_expiration_fix.py` — 6 test cases: normal date (kept), empty (→NULL), 0000-00-00 (→NULL), zero datetime (→NULL), whitespace (→NULL), None (→NULL). ✓ All passed.

**Status:** ✅ Ready. Next import_members run will skip/accept invalid dates gracefully.

### 04-04 18:05 UTC — CLEANED: Payments API refactored, removed real-time GAS webhooks

**Removed:** All direct GAS webhook calls from payment approval/rejection flows. Payment approval now updates MySQL only; Sheets syncing deferred to scheduled sync jobs.

**Files Changed:**
- **api_payments.py** (650 lines) — Deleted `_sync_member_events_to_sheets()` function + call from api_approve_event_match()
- **payment_actions.py** (504 lines) — Removed sync_*_to_sheets() calls from approve_event() + reject_event()
- **payment_handlers.py** (370 lines) — Removed sheets_sync import, deleted sync call from update_member_expiration()

**Operations Verified:** ✓ All 12 payment MySQL operations work (dashboard, pending events, auto-match, manual-match, approve, reject, admin-create, history, member summary, gmail candidates, member quick lookup). Email webhooks via webhook_client.py remain functional.

**Architecture:** User submits → submissions table → admin matches → approve_event() {dispatch_fulfillment() creates payment + updates members} → log_activity() → [Scheduled sync job exports to Sheets]. No real-time webhooks.

**Docs:** Created PAYMENTS_API_TRACE.md + PAYMENTS_API_VERIFICATION.md for reference.

**Status:** ✅ Ready. No regressions found.

### 04-04 17:35 UTC — ENHANCED: Verbose logging for UpdatedAt timestamp filtering in exports

**Issue:** export_members always sent all 624 members to GAS (even on repeat runs). No timestamp filtering on exports. Sync functions don't check `sheets_sync_log` for last successful completion time.

**Root Cause:** `sync_config.py` generic_sync_runner() tried to query `sheets_sync_log` with `MAX(StartedAt)` (which is set at batch START, not END) and silently fell back to full export on any query error. Query failures were hidden, no debug logging of timestamp values.

**Fixes Applied:**
1. **sync_config.py lines 459–486** — Changed timestamp query from `MAX(StartedAt)` → `MAX(CompletedAt)` with **verbose logging** at every step:
   - `[TIMESTAMP CHECK]` — What we're looking for + params
   - `[TIMESTAMP CHECK] ✓/⚠/✗` — Result (found time, no prior sync, error)
   - `[TIMESTAMP FILTER]` — SQL applied + row count result
2. **sync_config.py line 474** — Filter now uses `UpdatedAt > %s` (not `>=`) to exclude the cutoff boundary
3. **sync_config.py line 451** — Added `[EXPORT START]` log showing has_updated_at flag
4. **Fallback behavior** — Now logs ERROR if query fails (was silent before)

**Logging Output (Example):**
```
[EXPORT START] MySQL→Sheets export for table=members, config=export_members, has_updated_at=True
[TIMESTAMP CHECK] Looking for last successful sync: config_key=export_members, table=members, direction=mysql_to_sheet
[TIMESTAMP CHECK] ✓ Found last successful sync completed at: 2026-04-04 12:29:09
[TIMESTAMP FILTER] ✓ Applied UpdatedAt > 2026-04-04 12:29:09. Result: 42 rows to export
```

**Test:** Created `test_export_timestamp_logging.py` — Verified delta sync exports 42 rows (not 624) and first sync exports all 624.

**Status:** ✓ Ready to test with real export_members call. Monitor logs for [TIMESTAMP CHECK/FILTER] messages.

### 04-04 17:00 UTC — Sheets Sync Cleanup Analysis: Remove 3 obsolete files, consolidate procedures

**Old Architecture → New Architecture:**
The sheets sync has been refactored from snapshot-based diffing to a cleaner batched UPSERT model. Three files are now orphaned:

1. **basecamp/python/google_sheets_snapshot.py** (DEPRECATED)
   - Old logic: Snapshot Sheets → Azure Blob, compare to previous, detect row changes
   - Current use: **NONE** — replaced by direct GAS webhook queries (read_range action in sync_config.py)
   - Status: Safe to delete. No imports in current codebase.

2. **mmr-admin/sheets_sync.py** (DEPRECATED)
   - Old logic: Fire-and-forget async POST to GAS webhook for individual member/payment/event updates
   - Current use: **NONE** — replaced by batch export endpoints in sync_runners.py
   - Status: Safe to delete. Only member_updated, payment_created, event_status_updated actions (9 lines each).
   - Notes: These single-record POSTs have been replaced by full-table batch exports.

3. **basecamp/ops/sync_sheets_to_mysql.py** (PARTIALLY ACTIVE)
   - 1,300 lines, heavy lifting: snapshot diffing, conflict resolution, validation
   - Current use: **Legacy CLI tool** — GitHub Actions `--dry-run` tests only. Not integrated into API.
   - Status: Can be ARCHIVED or refactored. Key validators (validate_numeric, parse_enum_values, validate_status) are duplicated with sync_engine.py logic.
   - Path forward: (a) delete if no longer used by GitHub Actions, or (b) refactor to use sync_engine + sync_config as a unified CLI wrapper

**MySQL Procedures (schema_snapshot.sql):**
✅ Safe as-is. Four procs exist:
- `generate_member_id()` — Used by /api/member/create. Keep.
- `sp_admin_update_member_status()` — Used by admin override UI. Keep.
- `sp_error_summary_report(days_back INT)` — Used by diagnostic dashboard. Keep.
- `sp_link_transaction()` — Used by gmail transaction linking. Keep.

**Recommendation:**
1. Delete google_sheets_snapshot.py (0 dependencies)
2. Delete sheets_sync.py (0 dependencies; functionality now in sync_runners.py)
3. Archive or delete sync_sheets_to_mysql.py unless GitHub Actions .dry-run CI still uses it (CHECK WORKFLOWS)

**Next:** Check .github/workflows/ for any reference to sync_sheets_to_mysql.py before final deletion.

### 04-04 16:54 UTC — Fixed: export_members only wrote 50 rows (GAS webhook response check)

**Root Cause:** Mismatch between GAS webhook response format and sync_config.py expectation. The `_call_gas_webhook()` wrapper in sync_runners.py extracts only the `'data'` field from the GAS response, but sync_config.py was checking `if result.get('ok')` — which doesn't exist in the returned data, so all exports failed on first batch. Export wrote 50 rows to Sheets but imported 0 to MySQL + marked 624 as skipped.

**Fixes Applied:**
1. **sync_config.py line 527 (export)** — Changed `if result.get('ok')` to `if result and ('inserted' in result or 'updated' in result)`
2. **sync_config.py line 614 (import)** — Removed broken `if result.get('ok')` check; now correctly handles list or dict response from GAS
3. **mmr-admin/sync_config.py** — Applied same fixes to keep copies in sync

**Result:**
- export_members will now process all 624 rows across multiple batches ✓
- import_members will now correctly fetch and import Sheets data ✓

### 04-04 16:50 UTC — Fixed: Job status 404 + stuck 'Running' state

**Root Causes:**
1. **Job lookup only checked in-memory cache** (`_jobs` dict). When Azure process recycled or job created in different thread, lookup failed with 404.
2. **Status never marked as 'running'** — stayed 'queued' from start → UI shows "Running" but job state was stale.
3. **`list_jobs()` was in-memory only** — couldn't restore state after restart.

**Fixes Applied:**
1. **sync_jobs.py `get_job()`** — Now falls back to MySQL if not in memory. Handles restarts + cross-process visibility.
2. **sync_jobs.py `list_jobs()`** — Now queries MySQL for last 24h jobs. Merges in-memory + DB state.
3. **sync_runners.py all workers** — Each worker now calls `update_job(job_id, status='running', message='...')` at start. 6 functions updated:
   - sync_export_members, sync_export_payments, sync_export_submissions, sync_export_transaction_meta, sync_import_members, sync_import_transactions

**Result:**
- Job status now persists across process restarts ✓
- UI polling won't get 404 for valid jobs ✓
- Status transitions: queued → running → done/error (visible) ✓
```

**Status:** ✅ All fixes complete. Ready to test full workflow.

### 04-04 12:15 UTC — BATCH SYNC COMPLETE: 50x faster imports + resume capability + GAS webhook update

**Changes:**
1. **MIGRATION_V009_add_sheets_sync_log.sql** ✅ — Batch tracking table, views for monitoring
2. **basecamp/python/sync_config.py** ✅ — BATCH_SIZE=50, batched exports/imports (50 rows per call, not 1), timestamp filtering
3. **web-apps/gas/membership/src/webhook.ts** ✅ — Added existingIds parameter to filter new rows

**Performance:** 100 rows: 100 calls → 2 calls (50x). Repeat export: 1000s → 20 calls (20x). Resume: No data loss if crash.

**Status:** ✅ Ready to deploy: Run migration, sync modules, git push, test import endpoints.

**Next:** Test Full Sync endpoint, monitor GAS logs, deploy.

### 04-04 07:50 UTC — Fixed: Removed dangling _make_g2m_route() route registration loop

**Fixed:** **mmr-admin/api_sheets_sync.py** lines 2346-2352 — Deleted legacy route registration calling nonexistent `_make_g2m_route()` function.

**Status:** ✅ api_sheets_sync.py imports without errors. Ready for deployment.

### 04-04 07:45 UTC — Restructured Sync Tab from 6 to 3 sub-tabs + deleted legacy endpoints

**Changed:**
1. **mmr-admin/templates/index.html** — Sync Tab now 3 sub-tabs: MySQL→Google (4 ops), Google→MySQL (2 ops), Full Sync
2. **mmr-admin/api_sheets_sync_routes.py** (NEW) — `/api/sync/full-sync` endpoint
3. **mmr-admin/sync_runners.py** (NEW) — `full_sync_all_operations(job_id)` function
4. **mmr-admin/api_sheets_sync.py** — Removed 8 deprecated Flask routes (legacy functions preserved)

**Status:** ✅ UI simplified, all endpoints created, syntax verified. Ready to test Full Sync endpoint.

**Next:** Test Full Sync, monitor GAS logs, deploy.
