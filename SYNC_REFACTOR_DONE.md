# Sync Refactor — Implementation Done ✅

## What Was Done

### 1. Added `SyncRowResult` Class (sync_engine.py, lines ~728–761)
```python
class SyncRowResult:
    """Result of comparing a MySQL row with a Sheets row."""
    action       → 'insert' | 'update_mysql' | 'update_sheets' | 'match' | 'skip' | 'error'
    mysql_writes → Dict[col, val]
    sheets_writes→ Dict[col, val]
    diffs        → List[col]
    reason       → str
```

### 2. Implemented `compare_sync_rows()` Function (sync_engine.py, lines ~827–1001)
**Unified interface for all row comparison logic:**
- Handles INSERT (missing rows)
- Handles UPDATE (field diffs)
- Detects MATCH (no changes)
- Resolves conflicts via timestamp or direction-forced writes
- Supports backfill (Sheets fills NULL in MySQL)

**Parameters:**
```python
compare_sync_rows(
    primary_key='MemberID',
    key_value='A0001',
    mysql_row=dict_or_None,
    sheets_row=dict_or_None,
    compare_cols=['Status', 'Email', ...],
    ts_col='LastUpdated',              # for conflict resolution
    direction='bidirectional',         # 'mysql_to_sheets' | 'sheets_to_mysql' | 'bidirectional'
    backfill_cols=['Created', 'PaymentDate'],
)
```

### 3. Refactored `api_sheets_sync.py::_sync_members_to_sheets()` (lines ~550–590)

**Before (old logic):**
```python
decision = _engine_resolve_conflict_unix('members', member_id, member, sheets_member)
if decision.direction == SyncDecision.MYSQL_WINS:
    # ... manual field diff logic ...
    diff_fields = _get_field_diffs(member, sheets_member)
```

**After (unified):**
```python
result = compare_sync_rows(
    primary_key='MemberID',
    key_value=member_id,
    mysql_row=member,
    sheets_row=sheets_member,
    compare_cols=list(MEMBERS_SYNC_COLUMNS),
    ts_col='LastUpdated',
    direction='mysql_to_sheets',  # MySQL always wins for this endpoint
)

if result.action == SyncRowResult.UPDATE_SHEETS:
    # result.diffs already computed
    log_lines.append(f"🔄 UPDATE | {member_id} | {result.reason}")
```

### 4. Verification
✅ `sync_engine.py` imports cleanly
✅ `api_sheets_sync.py` syntax OK (python3 -m py_compile)
✅ 10/10 standalone modules pass import test

---

## Design Decisions

### Direction: `mysql_to_sheets` vs `bidirectional`
The member sync endpoint uses **`mysql_to_sheets`** because:
- It's a push-only operation (MySQL→Sheets via GAS webhook)
- Admin tool updates MySQL; Sheets is read-only source of truth for Google Forms intake
- Conflict resolution is **MySQL always wins** (no need for timestamp comparison)

If/when we add **bidirectional** member sync (Sheets←→MySQL):
- Set `direction='bidirectional'` + `ts_col='LastUpdated'`
- Timestamp logic kicks in: newer wins, Sheets wins on tie
- No code change needed to `compare_sync_rows()` — just flip the parameter

### Why `compare_cols=list(MEMBERS_SYNC_COLUMNS)`?
- `MEMBERS_SYNC_COLUMNS` (defined in sync_engine.py:61–69) is the whitelist of 22 syncable columns
- Prevents accidental sync of system columns (password, created_at, id, etc.)
- Single source of truth for what's syncable

---

## Next Steps

### Phase 1: Test & Deploy (1–2 hours)
1. **Deploy to staging:**
   - Commit `sync_engine.py` (new classes + function)
   - Commit `api_sheets_sync.py` (refactored member sync)
   - Run smoke test: POST to `/api/sheets-sync/members` endpoint
   - Verify logs show `SyncRowResult.UPDATE_SHEETS` decisions

2. **Backfill CreatedUnix (production):**
   ```sql
   UPDATE members SET CreatedUnix = UNIX_TIMESTAMP(Created)
   WHERE CreatedUnix = 0 AND Created IS NOT NULL;
   ```
   - Takes <1 second for ~1000 members
   - **Then** bidirectional sync becomes available

3. **Monitor:** Check logs for any parse errors or unexpected action choices

### Phase 2: Enable Bidirectional (1–2 hours)
Refactor other sync endpoints to use `compare_sync_rows()`:
1. `_sync_payments_to_sheets()` (lines ~750+)
2. `_sync_events_to_sheets()` (lines ~800+)
3. `_pull_members_from_sheets()` (Sheets→MySQL, if it exists)

Each gets one parameter change per sync direction:
- MySQL→Sheets: `direction='mysql_to_sheets'`
- Sheets→MySQL: `direction='sheets_to_mysql'`
- Bidirectional: `direction='bidirectional'` + `ts_col='...'`

### Phase 3: Schema/Workflow (planned, not in this PR)
- Add `UpdatedUnix` column to `payments` and `webapp_events` tables
- Write migrations that backfill from `ProcessedDate`, `UpdatedAt` respectively
- Update webhook to populate these Unix columns on INSERT/UPDATE

---

## Example: Using `compare_sync_rows()` Elsewhere

### Scenario 1: Pull Sheets→MySQL (overwrite MySQL from Sheets)
```python
result = compare_sync_rows(
    primary_key='MemberID',
    key_value=member_id,
    mysql_row=mysql_members.get(member_id),  # May be None
    sheets_row=sheets_member,
    compare_cols=list(MEMBERS_SYNC_COLUMNS),
    ts_col=None,  # Direction overrides timestamp; no comparison needed
    direction='sheets_to_mysql',  # Sheets always wins
)

if result.action == 'insert':
    # INSERT with result.mysql_writes
elif result.action == 'update_mysql':
    # UPDATE with result.mysql_writes
```

### Scenario 2: Smart bidirectional (newer wins)
```python
result = compare_sync_rows(
    primary_key='PaymentID',
    key_value=payment_id,
    mysql_row=mysql_payment,
    sheets_row=sheets_payment,
    compare_cols=['Status', 'Amount', 'Memo', ...],
    ts_col='ProcessedDate',  # Use timestamp to decide
    direction='bidirectional',  # Timestamp-based resolution
    backfill_cols=['Memo'],  # Sheets fills NULL Memo in MySQL
)

if result.action == 'update_mysql':
    execute("UPDATE payments SET ... WHERE PaymentID = %s",
            [result.mysql_writes['PaymentID']])
elif result.action == 'update_sheets':
    _call_gas_webhook({'action': 'update_payment', 'data': result.sheets_writes})
```

---

## Files Modified
- **sync_engine.py** (+290 lines): Added `SyncRowResult`, `compare_sync_rows()`, helpers
- **api_sheets_sync.py** (+4 imports, ~40 lines refactored): Use `compare_sync_rows()` in member sync

## Files NOT Modified (yet)
- `basecamp/ops/sync_sheets_to_mysql.py` — uses old `resolve_conflict_unix()`, can be refactored later
- Other sync endpoints (`_sync_payments_to_sheets()`, `_sync_events_to_sheets()`) — same pattern, low priority

---

## Testing

### Manual Test (staging)
1. Edit a member in MySQL (e.g., FirstName)
2. POST to `/api/sheets-sync/members` with `?dryrun=false`
3. Verify Sheets updated with new FirstName
4. Check logs for `SyncRowResult.UPDATE_SHEETS` reason

### Unit Test (future)
```python
def test_compare_sync_rows_mysql_wins():
    result = compare_sync_rows(
        primary_key='MemberID',
        key_value='A0001',
        mysql_row={'MemberID': 'A0001', 'Status': 'active', 'LastUpdated': '2026-04-01T10:00:00'},
        sheets_row={'MemberID': 'A0001', 'Status': 'inactive', 'LastUpdated': '2026-03-31T10:00:00'},
        compare_cols=['Status'],
        ts_col='LastUpdated',
        direction='bidirectional',
    )
    assert result.action == 'update_sheets'
    assert result.sheets_writes['Status'] == 'active'
```

---

## Rollback Plan
If issues arise:
1. Revert `api_sheets_sync.py` to use old `_engine_resolve_conflict_unix()` directly
2. Keep `sync_engine.py` changes (no breaking changes to existing functions)
3. All data in MySQL/Sheets remains intact; no state loss

---

**Status:** Ready for deployment to staging
**Estimated time to production:** 2–3 hours (test + deploy + backfill + monitor)

