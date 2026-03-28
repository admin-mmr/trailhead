# Debug Enhancements to `mmr-admin/api_sync.py`

## Summary
Added comprehensive debug logging throughout the sync pipeline to provide visibility into:
- API call invocations and data volumes
- Database operations (inserts, updates, connection lifecycle)
- Timing for each step and substep
- Throughput metrics (rows/sec)
- Error context and recovery attempts

---

## Changes Made

### 1. **Imports & Logger Setup**
- Added `import time` for performance measurements
- Set logger level to `DEBUG` explicitly: `logger.setLevel(logging.DEBUG)`

### 2. **Route Handler: `api_load_event()`**
- Logs incoming request: `event_id`, `force_reload` flag, full request JSON
- Logs event lookup result with `event_code`
- Debug-level messages for DB queries

### 3. **Worker Initialization: `_sync_worker()`**
- Logs start: `event_id`, `event_code`, `force_reload` setting
- Captures global `start_time` for total elapsed calculation
- Tracks step-by-step progress and timing

### 4. **Step 1: Finishers Fetch**
- ⏱️ `STEP 1: Starting finishers fetch...` → logs entry
- Progress callback logs: `Progress: N/M finishers` (debug level)
- ✅ `STEP 1 complete:` → logs count, elapsed time
- Stores `step1_elapsed_sec` in job status

**Example output:**
```
INFO - ⏱️  STEP 1: Starting finishers fetch...
DEBUG -   └─ Calling client.get_event_finishers(event_code=H2026)...
DEBUG -   Progress: 100/500 finishers
DEBUG -   Progress: 500/500 finishers
INFO - ✅ STEP 1 complete: 500 runners fetched in 3.45s
```

### 5. **Phase 1b: Database Upsert**
- Logs DB connection acquired
- If `force_reload=True`: logs deletion with row count
- Logs batch insert progress: batch size, elapsed time per batch, rows/sec
- ✅ Logs completion with throughput: `500 rows in 2.15s (232.6 rows/sec)`

**Example output:**
```
INFO - ⏱️  PHASE 1b: Upserting runners to database...
DEBUG -   └─ DB connection acquired
DEBUG -   └─ Starting batch upsert: BATCH_SIZE=500, total_runners=500
DEBUG -   └─ Batch 1: 500 rows in 1.234s, total=500/500
INFO - ✅ PHASE 1b complete: Upserted 500 rows in 2.15s (232.6 rows/sec)
```

### 6. **Step 2: Team Enumeration**
- ⏱️ `STEP 2: Fetching team list...` → logs entry
- Debug: API call to `client.search_teams()`
- ✅ `STEP 2 complete:` → logs team count, elapsed time
- Stores `step2_elapsed_sec` in job status

### 7. **Step 3: Backfill Team Code**
- ⏱️ `STEP 3: Backfilling team_code for each team...` → logs entry
- Per-team logging:
  - `Team N/M: fetching runners for team_code=<code>`
  - `Got M runners for <code>`
  - `<code>: N updates, T.ttt seconds`
- ✅ `STEP 3 complete:` → total teams, total assignments, elapsed time
- Stores `step3_elapsed_sec`, `total_backfilled` in job status

**Example output:**
```
INFO - ⏱️  STEP 3: Backfilling team_code for each team...
DEBUG -   └─ Team 1/584: fetching runners for team_code=TC001...
DEBUG -     └─ Got 12 runners for TC001
DEBUG -     └─ TC001: 12 updates, 0.045s
DEBUG -   └─ Team 2/584: fetching runners for team_code=TC002...
INFO - ✅ STEP 3 complete: 584 teams, 487 runner-team assignments in 28.34s
```

### 8. **Finalization**
- Logs event status update
- Queries final runner count in DB
- ✅ `FINALIZE complete:` → final count, elapsed time
- 🎉 `FULL SYNC COMPLETE:` → total time (minutes), summary stats
- Stores `finalize_elapsed_sec`, `total_elapsed_sec`, `final_count`, `total_backfilled` in job status

**Example output:**
```
INFO - ⏱️  Finalizing: updating nyrr_events status...
INFO - ✅ FINALIZE complete: 500 total runners in DB, 0.12s
INFO - 🎉 FULL SYNC COMPLETE in 33.97s (0.6m)
INFO -    Summary: 500 runners fetched, 584 teams, 487 assignments
```

### 9. **Error Handling**
- ❌ `SYNC FAILED for <event_code> after Ts`
- Logs exception type, message, and full traceback
- Logs DB update attempt and success/failure
- Stores `error_type`, `total_elapsed_sec` in job status
- Logs cleanup actions (connection closes)

**Example output:**
```
ERROR - ❌ SYNC FAILED for H2026 after 45.23s
ERROR -    Exception: DatabaseError: lost connection
ERROR -    Traceback: <full stack>
DEBUG -   └─ Updating nyrr_events and nyrr_processing_log with error...
DEBUG -   └─ Error status recorded in DB
```

---

## Status Endpoint Enhancements

The `/api/load/<event_code>/status` endpoint now returns additional fields:

```json
{
  "status": "done",
  "message": "✅ Sync complete: ...",
  "step": "finalize",
  "rows_written": 500,
  "teams_processed": 584,
  "total_backfilled": 487,
  "final_count": 500,
  "started_at": "2026-03-28T18:30:00.123456",
  "finished_at": "2026-03-28T18:30:34.098765",
  "step1_elapsed_sec": 3.45,
  "step2_elapsed_sec": 2.12,
  "step3_elapsed_sec": 28.34,
  "finalize_elapsed_sec": 0.12,
  "total_elapsed_sec": 34.03
}
```

Error responses also include:
```json
{
  "status": "error",
  "error_type": "DatabaseError",
  "message": "lost connection",
  "total_elapsed_sec": 45.23,
  "finished_at": "2026-03-28T18:30:45.654321"
}
```

---

## How to Use

1. **Run with `--debug` flag** (if supported by Flask):
   ```bash
   source load-env.sh && python3 mmr-admin/api_sync.py --debug
   ```

2. **Watch logs in real-time:**
   ```bash
   tail -f /path/to/logs/mmr-admin.log
   ```

3. **Poll sync status:**
   ```bash
   curl http://localhost:5000/api/load/H2026/status
   ```

4. **Check performance bottlenecks:**
   - Compare `step1_elapsed_sec` vs `step2_elapsed_sec` vs `step3_elapsed_sec`
   - Look for slow team-backfill steps (larger datasets = longer step 3)
   - Monitor `rows/sec` throughput in batch inserts

---

## Key Insights from Logs

### When Sync is Slow:
- **Step 1 slow?** → NYRR API is slow or paginated response is large
- **Phase 1b slow?** → Check DB connection, batch size, or index usage
- **Step 2 slow?** → NYRR team enumeration is slow
- **Step 3 slow?** → Many teams or large runner-per-team counts (expected to be slowest)

### When Sync Fails:
- Check exception type in error log → narrows down root cause (API, DB, network)
- Full traceback shows exact line and context
- `nyrr_processing_log` table records the failure for audit

---

## Lines Changed
- Import section: +1 line (`import time`)
- Logger setup: +1 line (`.setLevel(logging.DEBUG)`)
- Added ~100 lines of logging statements throughout
- **Total file size: ~350 lines** (was ~320 before) — still well under 400-line threshold

