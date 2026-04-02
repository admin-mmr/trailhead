# Handoff to Claude Sonnet — MMR Trailhead Sync System Investigation

## Context Summary
This is a continuation of multi-session sync system refactoring work on the MMR Trailhead running club management system. All major architectural changes have been implemented and committed. The next phase requires deeper investigation and testing to verify the fixes work end-to-end.

## What Has Been Done (Completed)

### 1. Unified Row Comparison Logic
- **File:** `basecamp/python/sync_engine.py` (source of truth, CI copies to `mmr-admin/sync_engine.py`)
- **Change:** Added `SyncRowResult` class (line ~800) and `compare_sync_rows()` function (~290 lines, line ~848)
- **Purpose:** Consolidates three separate conflict resolution implementations into a single function
- **Features:**
  - Action types: INSERT, UPDATE_MYSQL, UPDATE_SHEETS, MATCH, SKIP, ERROR
  - Timestamp-based conflict resolution (newer wins, Sheets wins on tie)
  - Bidirectional sync with direction parameter (`direction='mysql_to_sheets'` or `'sheets_to_mysql'`)

### 2. Format-Agnostic Value Comparison
- **Function:** `_coerce_val()` in sync_engine.py
- **Problem solved:** MySQL returns `datetime.date(2027, 3, 31)` but Sheets returns `'2027-03-31'`. Previous code treated these as different, causing false UPDATE messages.
- **Solution:** Converts all types to comparable strings:
  - `datetime.date` → ISO string ('2027-03-31')
  - `datetime.datetime` → ISO string with time
  - Numeric types (int, float) → string representation
  - Handles NULL comparisons correctly
- **Verified:** All format mismatch cases now correctly detect as MATCH (no spurious UPDATEs)

### 3. Verbose Logging Infrastructure
- **Files modified:**
  - `api_sheets_sync.py`: Added `verbose=` query parameter to 3 POST endpoints (members, events, payments)
  - `sync_engine.py`: Added `verbose` parameter to `compare_sync_rows()`; added `_log_result()` helper
  - `.github/workflows/bidirectional-sync.yml`: Added `workflow_dispatch.inputs.verbose` dropdown; updated 8 phases to pass flag
  - `.github/scripts/run_sync_phase.sh`: Appends `?verbose=true` to endpoint URL if flag is set
- **Behavior:** When verbose=true, logs every row comparison decision (inputs, diffs, timestamps, write dicts)
- **Testing:** Can be triggered via GitHub UI without code changes

### 4. Strict X-Cron-Token Authentication (LATEST FIX)
- **File:** `api_sheets_sync.py`, decorator `_cron_auth_or_session()` (lines 2184–2212)
- **Problem solved:** GitHub Actions requests with X-Cron-Token were being redirected to /login instead of authenticated
- **Root cause:** Decorator was checking token, but if token didn't match, it fell through to `login_required` which redirects
- **Fix:** If token is provided (header present), validate it strictly:
  - ✅ Token matches expected → proceed
  - ❌ Token provided but doesn't match → `abort(401)` (no fallback)
  - No token sent → fall back to session auth
- **Committed:** Just now (commit 125d6c4)

### 5. Shared Module Deduplication
- **Pattern:** `basecamp/python/` is source of truth; CI copies to `mmr-admin/` before build
- **Modules:** `sync_engine.py`, `nyrr_api.py`
- **CI behavior:** GitHub Actions copies both modules to `mmr-admin/` and regenerates on every build
- **Files:** `.gitignore` blocks `mmr-admin/sync_engine.py` and `mmr-admin/nyrr_api.py`
- **Documented:** SHARED_MODULES.md and CLAUDE.md updated

## What Needs Investigation (PENDING)

### 1. GitHub Actions Workflow Verification
**What to check:**
- Manually trigger `.github/workflows/bidirectional-sync.yml` with `workflow_dispatch`
- Set `verbose: true` in the UI
- Monitor all 8 sync phases (members→Sheets, events→Sheets, payments→Sheets, then reverse: Sheets→MySQL for all three)
- Expected behavior:
  - No 401 redirects (should authenticate with X-Cron-Token)
  - Verbose logs should show row-by-row comparison output
  - Phases should complete in sequence without hanging
- **Error signals to watch for:**
  - HTTP 401 or 403 errors
  - JSONDecodeError in run_sync_phase.sh (indicates malformed response)
  - Timeout on any phase >10 minutes
  - Empty response bodies

### 2. Format Mismatch False Positives
**What to test:**
- Run the workflow against live data
- Check Sync tab in mmr-admin portal for any "UPDATE_SHEETS" or "UPDATE_MYSQL" rows
- Expected: Only rows that actually changed (timestamps newer, values different) should show actions
- Verify no spurious UPDATEs for:
  - `Expiration` / `ExpirationDate` (date type mismatches)
  - `LastLogin` / `LastLoginDate` (datetime type mismatches)
  - `PaymentTransaction` (string vs numeric mismatches)
  - CreatedUnix (was causing all rows to be treated as SKIP before timestamp comparison fix)

### 3. Bidirectional Sync Enable Decision
**Current state:** Sync is disabled in production because "Sheets always win" (one-way only)
**Decision needed:** After verifying the workflow completes successfully and format matching works:
- Should bidirectional sync be re-enabled?
- Does the timestamp-based conflict resolution (newer wins, Sheets wins on tie) match business logic?
- Are there any edge cases or rollback procedures needed?

### 4. CreatedUnix=0 Blocking Sync
**What to verify:**
- In previous sessions, rows with `CreatedUnix=0` were being SKIP'd (not synced)
- The `compare_sync_rows()` function now has timestamp-based logic
- After running workflow, check:
  - Are rows with CreatedUnix=0 now being synced?
  - If timestamps are equal (both 0), does "Sheets wins on tie" apply correctly?
  - Should we backfill CreatedUnix with actual creation timestamps?

### 5. Error Handling Edge Cases
**Scenarios to test:**
- Network timeout mid-sync (does job resume or restart?)
- Partial sync completion (3 of 8 phases fail)
- Sheets API quota exceeded (what error does GAS return?)
- Invalid token in X-Cron-Token header (should get 401, not 500)
- Missing SYNC_CRON_TOKEN env var (what happens? fallback to session?)

## Files to Review During Investigation

### Core Sync Logic
- `basecamp/python/sync_engine.py` (lines ~848–1140): `compare_sync_rows()` function
- `basecamp/python/sync_engine.py` (lines ~700–750): `_coerce_val()` function
- `mmr-admin/api_sheets_sync.py` (lines 2184–2212): `_cron_auth_or_session()` decorator
- `mmr-admin/api_sheets_sync.py` (lines ~2220–2280): Member sync endpoint using `compare_sync_rows()`

### Workflow & Deployment
- `.github/workflows/bidirectional-sync.yml`: Trigger definition, env vars, job phases
- `.github/scripts/run_sync_phase.sh`: HTTP request logic, error handling, verbose flag support
- `.github/workflows/deploy-mmr-admin.yml`: CI step that copies basecamp modules to mmr-admin

### Documentation
- `SHARED_MODULES.md`: Deduplication pattern and local dev workflow
- `CLAUDE.md`: Added SHARED PYTHON MODULES section explaining pattern
- `_context.md`: Session log with all changes documented

## Testing Approach

### Phase 1: Pre-Flight Check
1. Verify import test passes: `python3 mmr-admin/test_imports.py`
2. Check .github YAML is valid: `yamllint .github/workflows/bidirectional-sync.yml`
3. Verify SYNC_CRON_TOKEN is set in Azure Web App secrets

### Phase 2: Workflow Execution
1. Navigate to GitHub Actions → bidirectional-sync.yml
2. Click "Run workflow" → set verbose=true
3. Monitor real-time logs for:
   - Authentication success (no 401 errors)
   - Verbose output showing row comparisons
   - All 8 phases completing

### Phase 3: Data Verification
1. Open mmr-admin → Sync tab
2. Run member sync manually: POST /api/sync/members?verbose=true
3. Check results for:
   - MATCH rows (no action needed)
   - INSERT/UPDATE rows (legitimate changes)
   - No ERROR or SKIP rows (unless expected)

### Phase 4: Cleanup & Re-enable
1. Backfill CreatedUnix for rows with value=0 if needed
2. Update sync direction config if business logic requires changes
3. Re-enable bidirectional sync in production if all tests pass

## Questions for Deep Dive

1. **Timestamp resolution:** When both MySQL and Sheets have timestamp=0 (uninitialized), current code says "Sheets wins on tie". Is this the desired behavior, or should we skip syncing until CreatedUnix is backfilled?

2. **Format conversions:** Are there any other column type mismatches not covered by `_coerce_val()`? (e.g., boolean columns, JSON fields, enum strings?)

3. **Error recovery:** If a sync phase fails halfway through (e.g., Sheets API rate limit), does the job persist state for resume, or does it restart from scratch?

4. **Verbose logging retention:** How long should verbose logs be retained in Azure logs? (They can be verbose and expensive.)

5. **Sync direction config:** Is there a config file or environment variable that controls which direction(s) are enabled (MySQL→Sheets, Sheets→MySQL, or both)?

## Success Criteria

✅ All 8 workflow phases complete successfully with verbose logging enabled
✅ No 401/403/500 errors in sync phase logs
✅ No spurious UPDATE messages for format-mismatched fields (dates, numbers, strings)
✅ CreatedUnix=0 rows are handled correctly (either synced or skipped, consistent with business logic)
✅ Bidirectional sync can be re-enabled with confidence in conflict resolution logic
✅ All imports pass locally and CI build succeeds

## Next Steps (Recommended for Sonnet)

1. **Immediate:** Manually trigger the GitHub Actions workflow with verbose=true and analyze the logs in detail
2. **Short-term:** Run targeted sync operations against live data to verify format matching and error handling
3. **Medium-term:** Create integration tests for edge cases (timeout, quota exceeded, partial sync)
4. **Long-term:** Document the sync architecture and conflict resolution strategy in SYNC_ARCHITECTURE.md

---

**Last updated:** 2026-04-02 22:31 UTC
**Current state:** All code changes committed; ready for testing
**Blockers:** None — all prerequisites met
