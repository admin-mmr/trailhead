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
