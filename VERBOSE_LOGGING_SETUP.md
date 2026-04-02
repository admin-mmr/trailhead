# Verbose Logging Setup for Sync Operations

## Overview

Added comprehensive verbose logging to sync operations with support for:
- **Query parameter activation**: `?verbose=true` in API requests
- **GitHub Actions UI input**: Dropdown to enable/disable verbose mode
- **Per-row debugging**: Detailed input/output for each row comparison in `compare_sync_rows()`

---

## Usage

### Option 1: Manual Trigger via GitHub UI

1. Go to GitHub → **Actions** → **Full Bidirectional Sync**
2. Click **Run workflow**
3. Set **"Enable verbose logging (shows sample rows and diffs)"** to `true`
4. Click **Run workflow**
5. Check logs for detailed debugging output

### Option 2: API Endpoint with Verbose Parameter

```bash
curl -X POST https://mmr-admin.azurewebsites.net/api/sync/mysql-to-google/members?verbose=true \
  -H "X-Cron-Token: $CRON_TOKEN"
```

### Option 3: Cron Job (Scheduled Sync)

Verbose mode only works when triggered manually via `workflow_dispatch`. Scheduled cron runs use default `verbose=false`.

---

## What Gets Logged with `verbose=true`

### 1. Sample Data (if available)

**Members sync** shows first 3 rows from each source:

```
📥 Fetched 1,247 members from MySQL
   Columns (35): MemberID, Status, Created, Expiration, Email, FirstName, LastName, ...
   [Row 1] A0001: John Doe, LastUpdated='2026-04-02T10:30:00'
   [Row 2] A0002: Jane Smith, LastUpdated='2026-04-01T15:45:00'
   [Row 3] A0003: Bob Johnson, LastUpdated='2026-03-28T09:15:00'

📊 Fetched 1,245 members from Google Sheets
   Columns (22): MemberID, Status, Email, FirstName, LastName, ...
   [Row 1] A0001: John Doe, LastUpdated='2026-04-02T10:30:00'
   [Row 2] A0002: Jane Smith, LastUpdated='2026-04-01T14:00:00'
   [Row 3] A0003: Bob Johnson, LastUpdated='2026-03-28T09:15:00'
```

### 2. Row-by-Row Comparison (inside `compare_sync_rows()`)

For each member compared:

```
[DEBUG] compare_sync_rows: MemberID=A0001
  MySQL: {'MemberID': 'A0001', 'Status': 'active', 'FirstName': 'John', 'LastUpdated': '2026-04-02T10:30:00', ...}
  Sheets: {'MemberID': 'A0001', 'Status': 'active', 'FirstName': 'John', 'LastUpdated': '2026-04-02T10:30:00', ...}
  direction=mysql_to_sheets, ts_col=LastUpdated
  ➜ match: No differences
```

**Example with differences:**

```
[DEBUG] compare_sync_rows: MemberID=A0002
  MySQL: {'MemberID': 'A0002', 'Status': 'active', 'FirstName': 'Jane', 'Email': 'jane@example.com', 'LastUpdated': '2026-04-01T15:45:00'}
  Sheets: {'MemberID': 'A0002', 'Status': 'active', 'FirstName': 'Jane', 'Email': 'jane@old.com', 'LastUpdated': '2026-04-01T14:00:00'}
  direction=mysql_to_sheets, ts_col=LastUpdated
  Differences found: ['Email']
  Timestamp comparison: MySQL=2026-04-01 15:45:00, Sheets=2026-04-01 14:00:00
  ➜ update_sheets: MySQL newer (2026-04-01 15:45:00 > 2026-04-01 14:00:00); updating Sheets
    Sheets writes: {'MemberID': 'A0002', 'Email': 'jane@example.com'}
```

### 3. Summary Logs

After all rows are processed:

```
✅ INSERTED: 5 new members → appended to Sheets
🔄 UPDATED: 12 members → synced field changes to Sheets
= MATCHED: 1,228 members → no changes needed
⏭️ SKIPPED: 0 conflicts → Sheets wins by decision rule
```

---

## Implementation Details

### 1. Query Parameter Parsing

**File:** `api_sheets_sync.py` (all sync endpoints)

```python
@sheets_sync_bp.route('/api/sync/mysql-to-google/members', methods=['POST'])
@login_required
def api_sync_members():
    verbose = request.args.get('verbose', 'false').lower() == 'true'
    job_id = launch_job(_sync_members_to_sheets, verbose=verbose)
    return json_response({'ok': True, 'job_id': job_id, 'verbose': verbose})
```

**Three endpoints support verbose:**
- `/api/sync/mysql-to-google/members?verbose=true`
- `/api/sync/mysql-to-google/events?verbose=true`
- `/api/sync/mysql-to-google/payments?verbose=true`

### 2. Worker Function Signature

**File:** `api_sheets_sync.py`

```python
def _sync_members_to_sheets(job_id: str, verbose: bool = False):
    verbose_mode = verbose  # Use parameter instead of hardcoded True
```

**Updated functions:**
- `_sync_members_to_sheets(job_id, verbose=False)`
- `_sync_events_to_sheets(job_id, verbose=False)`
- `_sync_payments_to_sheets(job_id, verbose=False)`

### 3. Compare Function Logging

**File:** `sync_engine.py`

New `compare_sync_rows()` parameter:

```python
def compare_sync_rows(
    *,
    primary_key: str,
    key_value: str,
    mysql_row: Optional[Dict[str, Any]],
    sheets_row: Optional[Dict[str, Any]],
    compare_cols: List[str],
    ts_col: Optional[str] = None,
    direction: str = 'bidirectional',
    backfill_cols: Optional[List[str]] = None,
    verbose: bool = False,  # ← NEW
) -> SyncRowResult:
```

**Logging helper function:**

```python
def _log_result(result: SyncRowResult, verbose: bool) -> SyncRowResult:
    """Log result details if verbose mode is enabled, then return."""
    if verbose:
        if result.action in ('update_mysql', 'update_sheets', 'insert'):
            logger.debug(f"  ➜ {result.action}: {result.reason}")
            if result.mysql_writes:
                logger.debug(f"    MySQL writes: {result.mysql_writes}")
            if result.sheets_writes:
                logger.debug(f"    Sheets writes: {result.sheets_writes}")
        else:
            logger.debug(f"  ➜ {result.action}: {result.reason}")
    return result
```

**All return statements wrapped with `_log_result()`:**

```python
return _log_result(SyncRowResult(...), verbose)
```

### 4. GitHub Actions Workflow

**File:** `.github/workflows/bidirectional-sync.yml`

Added `workflow_dispatch` input:

```yaml
workflow_dispatch:
  inputs:
    verbose:
      description: 'Enable verbose logging (shows sample rows and diffs)'
      required: false
      default: 'false'
      type: choice
      options:
        - 'false'
        - 'true'
```

Environment variable:

```yaml
env:
  VERBOSE: ${{ inputs.verbose || 'false' }}
```

All 8 job phases use:

```yaml
run: bash .github/scripts/run_sync_phase.sh /api/sync/mysql-to-google/members ${{ env.VERBOSE == 'true' && '--verbose' || '' }}
```

### 5. Shell Script

**File:** `.github/scripts/run_sync_phase.sh`

Query parameter appending:

```bash
ENDPOINT="${1:?endpoint argument required}"
VERBOSE="${2:-}"  # Optional --verbose flag

# Append ?verbose=true if --verbose flag is set
if [ "$VERBOSE" = "--verbose" ]; then
  ENDPOINT="${ENDPOINT}?verbose=true"
fi

curl -sf -X POST "$ADMIN_URL$ENDPOINT" ...
```

---

## Flow Diagram

```
User clicks "Run workflow" → GitHub UI shows verbose=true/false
                                    ↓
                    GitHub Actions sets env.VERBOSE
                                    ↓
                    run_sync_phase.sh appends ?verbose=true
                                    ↓
                    POST /api/sync/.../members?verbose=true
                                    ↓
                    api_sync_members() reads query param
                                    ↓
                    launch_job(_sync_members_to_sheets, verbose=True)
                                    ↓
                    _sync_members_to_sheets(verbose=True)
                                    ↓
                    Shows sample rows if verbose_mode=True
                                    ↓
                    For each row: compare_sync_rows(..., verbose=True)
                                    ↓
                    Logs input/output for each comparison
                                    ↓
                    _log_result() wraps every decision
                                    ↓
                    Azure logs display full debug trace
```

---

## Example: Debugging a Sync Issue

### Scenario: Email field not syncing

1. **Run with verbose=true** via GitHub UI
2. **Check logs** for member with mismatched email
3. **Look for `compare_sync_rows()` debug output:**

```
[DEBUG] compare_sync_rows: MemberID=A0005
  MySQL: {..., 'Email': 'new@example.com', 'LastUpdated': '2026-04-02T12:00:00'}
  Sheets: {..., 'Email': 'old@example.com', 'LastUpdated': '2026-04-02T12:00:00'}
  direction=mysql_to_sheets, ts_col=LastUpdated
  Differences found: ['Email']
  Timestamp comparison: MySQL=2026-04-02 12:00:00, Sheets=2026-04-02 12:00:00
  ➜ update_sheets: Timestamps tied (2026-04-02 12:00:00); Sheets wins by default
    Sheets writes: {}
```

**Issue:** Timestamps are tied, so Sheets wins even though MySQL has newer data. Solution: Update `LastUpdated` in MySQL before syncing.

---

## Performance Impact

- **Minimal overhead** when `verbose=false` (default)
- **Small overhead** when `verbose=true`: Additional logging only, no extra database queries or API calls
- **Log volume**: ~20–50 lines per member synced with verbose=true
- **Total cost**: ~0.5–1MB logs for 1000-member sync with verbose=true

---

## Files Modified

1. **mmr-admin/api_sheets_sync.py**
   - Added `verbose=` query parameter parsing to 3 endpoints
   - Updated 3 worker functions to accept `verbose` parameter
   - Pass `verbose` to `compare_sync_rows()` calls

2. **mmr-admin/sync_engine.py**
   - Added `verbose` parameter to `compare_sync_rows()`
   - Added `_log_result()` helper function
   - Wrapped all return statements with logging

3. **.github/workflows/bidirectional-sync.yml**
   - Added `workflow_dispatch.inputs.verbose` dropdown
   - Added `env.VERBOSE` environment variable
   - Updated all 8 job phases to pass verbose flag

4. **.github/scripts/run_sync_phase.sh**
   - Support optional `--verbose` argument
   - Append `?verbose=true` to endpoint URL if flag set

---

## Testing

### Local Test

```bash
# Trigger sync with verbose=true
curl -X POST "http://localhost:5000/api/sync/mysql-to-google/members?verbose=true" \
  -H "Authorization: Bearer <token>"

# Check logs for [DEBUG] messages
```

### GitHub Actions Test

1. Go to **Actions** → **Full Bidirectional Sync**
2. **Run workflow**
3. Set **verbose** to `true`
4. View job logs → search for `[DEBUG]` or `compare_sync_rows`

---

## Future Enhancements

- [ ] Add environment variable `SYNC_VERBOSE=true` to always enable verbose mode
- [ ] Add log level filtering: `SYNC_LOG_LEVEL=DEBUG|INFO|WARNING|ERROR`
- [ ] Export verbose logs to structured file (JSON Lines) for analysis
- [ ] Add `?sample=10` parameter to limit sample rows shown (instead of always 3)
- [ ] Add `?filter=MemberID` parameter to focus on specific rows

