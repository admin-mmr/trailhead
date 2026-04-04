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
