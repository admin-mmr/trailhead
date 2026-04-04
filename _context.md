### 04-04 15:22 UTC — Fixed: Production sync errors (datetime format + job FK constraint)

**Fixes:**
1. **DateTime conversion** — Added _convert_iso_to_mysql_datetime() to convert ISO 8601 (GAS format) → MySQL datetime. Fixes `Incorrect datetime value: 2026-04-04T11:57:01.000Z` errors.
2. **Job persistence** — sync_jobs.py now INSERTs/UPDATEs MySQL sync_jobs table on launch_job()/update_job(). Fixes FK constraint failure on batch logging.
3. **Graceful batch logging** — FK errors no longer crash sync; logged as debug instead.

**Status:** ✅ Both issues fixed & tested. Ready for production.

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
