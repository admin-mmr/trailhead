# Sync Refactor Analysis & Proposal

## 1. Current Member→Sheets Sync Flow

**Column used for version resolution:** `LastUpdated` (ISO 8601 datetime)

In `sheets_sync.py::sync_member_to_sheets()`:
- Reads full member row from MySQL
- POSTs to GAS webhook with `action='member_updated'`
- Sends all 25 sync-able fields (Status, Expiration, Email, etc.)
- **No version checking** — always overwrites Sheets, fire-and-forget

**Why `updated_at_unix` is populated:**
- The bidirectional sync engine (`sync_engine.py`) auto-populates `*_unix` columns for every datetime field
- MySQL triggers or application code creates: `LastUpdatedUnix`, `CreatedUnix`, `LastLoginUnix`, etc.
- These Unix timestamps enable fast comparison without string parsing (lines 366+ in sync_engine.py)

---

## 2. What Is `responseStatus=200`?

HTTP 200 means the GAS webhook **received the request and executed without throwing an error**.
- `ok=true` in response body confirms the Google Apps Script ran cleanly
- Data was written to the Sheets tab (but no validation of actual cell updates)

**Why it's useful:**
- Confirms the webhook endpoint is reachable
- Confirms GAS script did not crash
- Does NOT confirm data was written correctly (GAS could silently skip rows)

---

## 3. The Problem: `unixtime = 0` Blocks Bidirectional Sync

### Current Behavior
When MySQL has `CreatedUnix = 0` or NULL, the conflict resolver assumes MySQL is stale:

```python
# sync_engine.py lines ~395–405
if mysql_unix is None or mysql_unix == 0:
    return SyncDecision(
        SyncDecision.SHEETS_WINS,
        f'MySQL Unix timestamp missing; Sheets ({sheets_unix}) wins',
    )
```

**Result:** Bidirectional sync is disabled because Sheets **always** wins on all members (no one has valid CreatedUnix).

### Root Cause
- Members table was populated long ago without `CreatedUnix`
- Current writes populate it (via triggers or app logic), but legacy rows are `0`
- No backfill migration was run

---

## 4. Proposed Solution: Unified `compare_sync_rows()` Function

### Current Duplication Problem
- `api_sheets_sync.py::pull_members_from_sheets()` → duplicate conflict logic
- `basecamp/ops/sync_sheets_to_mysql.py` → duplicate conflict logic
- `sync_engine.py::resolve_conflict()` → only handles standard tables
- `sync_engine.py::resolve_conflict_unix()` → only handles Unix timestamp comparison
- Each has its own decision trees, logging, and column filtering

### Proposed Unified Interface

```python
# sync_engine.py — NEW FUNCTION (lines 700+)

class SyncRowResult:
    """Result of comparing MySQL and Sheets rows."""
    __slots__ = ('action', 'mysql_writes', 'sheets_writes', 'diffs', 'reason')

    # Actions
    INSERT = 'insert'                  # Row missing from target
    UPDATE_MYSQL = 'update_mysql'
    UPDATE_SHEETS = 'update_sheets'
    MATCH = 'match'                    # No differences
    SKIP = 'skip'                      # Conflict; decision is no-write
    ERROR = 'error'                    # Validation error

    def __init__(
        self,
        action: str,
        mysql_writes: Optional[Dict[str, Any]] = None,
        sheets_writes: Optional[Dict[str, Any]] = None,
        diffs: Optional[List[str]] = None,
        reason: str = '',
    ):
        self.action = action
        self.mysql_writes = mysql_writes or {}
        self.sheets_writes = sheets_writes or {}
        self.diffs = diffs or []
        self.reason = reason

    def __repr__(self) -> str:
        return f'SyncRowResult({self.action}: {self.reason})'


def compare_sync_rows(
    *,
    primary_key: str,                          # e.g. 'MemberID'
    key_value: str,                            # e.g. 'A0001'
    mysql_row: Optional[Dict[str, Any]],       # None if row doesn't exist in MySQL
    sheets_row: Optional[Dict[str, Any]],      # None if row doesn't exist in Sheets
    compare_cols: List[str],                   # Which fields to diff
    ts_col: Optional[str] = None,              # Timestamp column (e.g. 'LastUpdated')
    direction: str = 'bidirectional',          # 'mysql_to_sheets' | 'sheets_to_mysql' | 'bidirectional'
    backfill_cols: Optional[List[str]] = None, # Fields where Sheets value fills NULL in MySQL
) -> SyncRowResult:
    """
    Compare a single row from MySQL and Sheets, return action + writes.

    Resolution logic (in order):
      1. One side is NULL → INSERT action (copy other side)
      2. Both sides exist, no diffs → MATCH
      3. Both sides exist, diffs found:
         a. If direction='mysql_to_sheets' → UPDATE_SHEETS (copy MySQL)
         b. If direction='sheets_to_mysql' → UPDATE_MYSQL (copy Sheets)
         c. If direction='bidirectional' + ts_col → newer wins (SHEETS_WINS or MYSQL_WINS on tie)
         d. If direction='bidirectional' + no ts_col → SKIP (cannot resolve)
      4. Backfill: If a col is in backfill_cols and MySQL is NULL but Sheets has value → add to mysql_writes

    Args:
        primary_key:    Column name used as primary key ('MemberID', 'PaymentID', etc.)
        key_value:      Primary key value ('A0001', 'PAY-123', etc.) — for logging only
        mysql_row:      Row dict from MySQL, or None if not present
        sheets_row:     Row dict from Sheets, or None if not present
        compare_cols:   List of column names to compare (whitelist)
        ts_col:         Name of timestamp column for version resolution.
                        If None, bidirectional sync cannot resolve conflicts.
        direction:      Sync direction:
                        'mysql_to_sheets' → MySQL always wins
                        'sheets_to_mysql' → Sheets always wins
                        'bidirectional' → timestamp-based or SKIP if tied
        backfill_cols:  Cols where if MySQL is NULL and Sheets has value, fill MySQL
                        (only used if direction includes MySQL as target)

    Returns:
        SyncRowResult with .action, .mysql_writes, .sheets_writes, .diffs, .reason

    Raises:
        ValueError: if primary_key not in both rows (when both exist), or invalid direction
    """
    if direction not in ('mysql_to_sheets', 'sheets_to_mysql', 'bidirectional'):
        raise ValueError(f"Invalid direction: {direction}")

    if backfill_cols is None:
        backfill_cols = []

    # ──────────────────────────────────────────────────────────────────────
    # Case 1: One side is NULL → INSERT
    # ──────────────────────────────────────────────────────────────────────

    if mysql_row is None and sheets_row is None:
        return SyncRowResult(
            SyncRowResult.ERROR,
            reason=f"Both MySQL and Sheets rows are NULL for {primary_key}={key_value}"
        )

    if mysql_row is None:
        # Row exists in Sheets but not MySQL → INSERT into MySQL
        if direction in ('sheets_to_mysql', 'bidirectional'):
            return SyncRowResult(
                SyncRowResult.INSERT,
                mysql_writes=_filter_row(sheets_row, compare_cols, primary_key),
                diffs=list(compare_cols),
                reason=f"Row missing from MySQL; inserting from Sheets"
            )
        else:  # mysql_to_sheets only
            return SyncRowResult(
                SyncRowResult.SKIP,
                reason=f"Row missing from MySQL; direction={direction} → SKIP"
            )

    if sheets_row is None:
        # Row exists in MySQL but not Sheets → INSERT into Sheets
        if direction in ('mysql_to_sheets', 'bidirectional'):
            return SyncRowResult(
                SyncRowResult.INSERT,
                sheets_writes=_filter_row(mysql_row, compare_cols, primary_key),
                diffs=list(compare_cols),
                reason=f"Row missing from Sheets; inserting from MySQL"
            )
        else:  # sheets_to_mysql only
            return SyncRowResult(
                SyncRowResult.SKIP,
                reason=f"Row missing from Sheets; direction={direction} → SKIP"
            )

    # ──────────────────────────────────────────────────────────────────────
    # Case 2: Both rows exist — compare fields
    # ──────────────────────────────────────────────────────────────────────

    diffs = _diff_rows(mysql_row, sheets_row, compare_cols)

    if not diffs:
        return SyncRowResult(
            SyncRowResult.MATCH,
            diffs=[],
            reason="No differences"
        )

    # ──────────────────────────────────────────────────────────────────────
    # Case 3: Differences found — resolve based on direction + timestamp
    # ──────────────────────────────────────────────────────────────────────

    if direction == 'mysql_to_sheets':
        return SyncRowResult(
            SyncRowResult.UPDATE_SHEETS,
            sheets_writes=_filter_row(mysql_row, diffs, primary_key),
            diffs=diffs,
            reason=f"Updating Sheets: {', '.join(diffs)}"
        )

    if direction == 'sheets_to_mysql':
        mysql_writes = _filter_row(sheets_row, diffs, primary_key)
        # Apply backfill logic: if MySQL col is NULL, Sheets wins
        for col in backfill_cols:
            if col in diffs and mysql_row.get(col) is None and sheets_row.get(col):
                mysql_writes[col] = sheets_row[col]

        return SyncRowResult(
            SyncRowResult.UPDATE_MYSQL,
            mysql_writes=mysql_writes,
            diffs=diffs,
            reason=f"Updating MySQL: {', '.join(diffs)}"
        )

    # direction == 'bidirectional'
    if ts_col is None:
        return SyncRowResult(
            SyncRowResult.SKIP,
            diffs=diffs,
            reason=f"Bidirectional sync but no ts_col configured; cannot resolve {', '.join(diffs)}"
        )

    # Timestamp-based resolution
    mysql_ts = parse_datetime(mysql_row.get(ts_col), silent=True)
    sheets_ts = parse_datetime(sheets_row.get(ts_col), silent=True)

    # Both NULL or 0 → Sheets wins (conservative)
    if (mysql_ts is None and sheets_ts is None):
        return SyncRowResult(
            SyncRowResult.UPDATE_MYSQL,
            mysql_writes=_filter_row(sheets_row, diffs, primary_key),
            diffs=diffs,
            reason=f"Both timestamps NULL; Sheets wins by default"
        )

    # One NULL → the one with a timestamp wins
    if mysql_ts is None:
        return SyncRowResult(
            SyncRowResult.UPDATE_MYSQL,
            mysql_writes=_filter_row(sheets_row, diffs, primary_key),
            diffs=diffs,
            reason=f"MySQL timestamp missing; Sheets ({sheets_ts}) wins"
        )

    if sheets_ts is None:
        return SyncRowResult(
            SyncRowResult.UPDATE_SHEETS,
            sheets_writes=_filter_row(mysql_row, diffs, primary_key),
            diffs=diffs,
            reason=f"Sheets timestamp missing; MySQL ({mysql_ts}) wins"
        )

    # Both have timestamps → newer wins, Sheets wins on tie
    if mysql_ts > sheets_ts:
        return SyncRowResult(
            SyncRowResult.UPDATE_SHEETS,
            sheets_writes=_filter_row(mysql_row, diffs, primary_key),
            diffs=diffs,
            reason=f"MySQL newer ({mysql_ts} > {sheets_ts}); updating Sheets"
        )
    elif sheets_ts > mysql_ts:
        return SyncRowResult(
            SyncRowResult.UPDATE_MYSQL,
            mysql_writes=_filter_row(sheets_row, diffs, primary_key),
            diffs=diffs,
            reason=f"Sheets newer ({sheets_ts} > {mysql_ts}); updating MySQL"
        )
    else:
        # Tie → Sheets wins
        return SyncRowResult(
            SyncRowResult.UPDATE_MYSQL,
            mysql_writes=_filter_row(sheets_row, diffs, primary_key),
            diffs=diffs,
            reason=f"Timestamps tied ({mysql_ts}); Sheets wins by default"
        )


# ─────────────────────────────────────────────────────────────────────────
# Helper functions (keep private)
# ─────────────────────────────────────────────────────────────────────────

def _filter_row(
    row: Dict[str, Any],
    cols: List[str],
    pk_col: str,
) -> Dict[str, Any]:
    """Extract only the specified columns from a row, preserving primary key."""
    result = {}
    for col in cols:
        if col in row:
            result[col] = row[col]
    # Always include primary key if not in cols
    if pk_col not in result and pk_col in row:
        result[pk_col] = row[pk_col]
    return result


def _diff_rows(
    mysql_row: Dict[str, Any],
    sheets_row: Dict[str, Any],
    compare_cols: List[str],
) -> List[str]:
    """Find which columns differ between MySQL and Sheets rows."""
    diffs = []
    for col in compare_cols:
        mysql_val = mysql_row.get(col)
        sheets_val = sheets_row.get(col)

        # Normalize: None == '' == 0 for comparison
        if _normalize_val(mysql_val) != _normalize_val(sheets_val):
            diffs.append(col)

    return diffs


def _normalize_val(val: Any) -> Any:
    """Normalize empty values for comparison: None, '', 0 all become None."""
    if val is None or val == '' or val == 0:
        return None
    return val
```

---

## 5. Migration: Fix CreatedUnix

```sql
-- One-time backfill (run after code is deployed)
UPDATE members
SET CreatedUnix = UNIX_TIMESTAMP(Created)
WHERE CreatedUnix = 0 AND Created IS NOT NULL;

-- Verify
SELECT COUNT(*) as 'Fixed rows' FROM members WHERE CreatedUnix > 0;
```

---

## 6. Usage in Existing Callers

### Before (duplicated logic in api_sheets_sync.py):
```python
for mysql_member in mysql_rows:
    # ... custom resolve_conflict logic here ...
    diffs = _find_diffs(mysql_member, sheets_member)
    decision = resolve_conflict('members', mysql_member['MemberID'], mysql_member, sheets_member)
    if decision.direction == 'sheets_wins':
        # ... update MySQL ...
```

### After (unified):
```python
from sync_engine import compare_sync_rows, MEMBERS_SYNC_COLUMNS

for mysql_member in mysql_rows:
    sheets_member = sheets_lookup.get(mysql_member['MemberID'])

    result = compare_sync_rows(
        primary_key='MemberID',
        key_value=mysql_member['MemberID'],
        mysql_row=mysql_member,
        sheets_row=sheets_member,
        compare_cols=list(MEMBERS_SYNC_COLUMNS),
        ts_col='LastUpdated',
        direction='bidirectional',
        backfill_cols=['Created', 'PaymentDate', 'LastLogin'],  # Sheets fills NULL in MySQL
    )

    if result.action == 'update_mysql':
        # Execute UPDATE with result.mysql_writes
    elif result.action == 'update_sheets':
        # POST to GAS webhook with result.sheets_writes
    elif result.action == 'insert':
        # INSERT new row with result.mysql_writes or .sheets_writes
```

---

## 7. Benefits

1. **Single source of truth:** All sync logic in one place
2. **Consistent behavior:** Same rules across all endpoints
3. **Easier testing:** Test `compare_sync_rows()` once, use everywhere
4. **Clear interface:** Decision + writes + diffs all in one result object
5. **Flexible:** direction + ts_col + backfill_cols cover all use cases
6. **Maintainable:** Adding new tables or rules is one change, not three

---

## 8. Next Steps

1. ✅ Review this analysis (you are here)
2. Add `SyncRowResult` class + `compare_sync_rows()` function to `sync_engine.py`
3. Run `python3 -m mmr_admin.test_imports` to verify imports
4. Refactor `api_sheets_sync.py::pull_members_from_sheets()` to use `compare_sync_rows()`
5. Refactor `basecamp/ops/sync_sheets_to_mysql.py` to use `compare_sync_rows()`
6. Run backfill migration: `UPDATE members SET CreatedUnix = UNIX_TIMESTAMP(Created) ...`
7. Enable MySQL→Sheets bidirectional sync in config
8. Test pull + push cycles in dev/staging

