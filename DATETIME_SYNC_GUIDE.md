# Datetime Sync Strategy: Unix Columns as Source of Truth

## Problem Statement

**Current issue:** Datetime columns sync with timezone mismatches between MySQL (UTC) and Google Sheets (stored as EDT local time with `Z` suffix, appearing UTC).

```
MySQL:     Created = datetime(2025, 2, 18, 0, 27, 13)  [UTC]
Sheets:    Created = '2025-02-18T05:27:13.000Z'        [EDT stored as UTC]
Detected as different: ❌ 5-hour offset
```

**Root cause:**
- MySQL sends `datetime` object (UTC) to GAS
- GAS serializes via `json.dumps()` → local browser time + "Z" suffix
- Sheets stores this (appears UTC, is actually EDT)
- Python sync parses `Z` as UTC → mismatch with MySQL UTC

**Solution:** Use **Unix timestamp columns** as the canonical sync source. Unix timestamps are timezone-agnostic (seconds since epoch), eliminating ambiguity.

---

## Architecture Overview

### Column Definitions (Metadata)

Define each table's datetime columns **with their Unix counterparts** in `DATETIME_COLUMNS`:

```python
DATETIME_COLUMNS: Dict[str, Dict[str, str]] = {
    'members': {
        'Created': {
            'unix_column': 'CreatedUnix',
            'sheets_datetime': 'Created',
            'sheets_unix': 'CreatedUnix',  # if storing both in Sheets
        },
        'LastUpdated': {
            'unix_column': 'LastUpdatedUnix',
            'sheets_datetime': 'LastUpdated',
            'sheets_unix': 'LastUpdatedUnix',
        },
        'LastLogin': {
            'unix_column': 'LastLoginUnix',
            'sheets_datetime': 'LastLogin',
            'sheets_unix': 'LastLoginUnix',
        },
        'PaymentDate': {
            'unix_column': 'PaymentDateUnix',
            'sheets_datetime': 'PaymentDate',
            'sheets_unix': 'PaymentDateUnix',
        },
    },
    'payments': {
        'ProcessedDate': {
            'unix_column': 'ProcessedDateUnix',
            'sheets_datetime': 'ProcessedDate',
            'sheets_unix': 'ProcessedDateUnix',
        },
    },
}
```

### Data Flow (Three-Layer Model)

```
┌─────────────────────────────────────────────────────────────────┐
│ LAYER 1: MYSQL (Source of Truth)                               │
│ ─────────────────────────────────────────────────────────────── │
│ Created          = datetime(2025, 2, 18, 0, 27, 13) [UTC]       │
│ CreatedUnix      = 1739865633                        [seconds]   │
│ LastUpdated      = datetime(2026, 3, 17, 3, 24, 47) [UTC]       │
│ LastUpdatedUnix  = 1742252687                        [seconds]   │
└─────────────────────────────────────────────────────────────────┘
                          ↓ serialize
                    (convert to JSON)
┌─────────────────────────────────────────────────────────────────┐
│ LAYER 2: JSON / GAS (Transit)                                   │
│ ─────────────────────────────────────────────────────────────── │
│ "Created": "2025-02-18T00:27:13Z"   [ISO UTC]                   │
│ "CreatedUnix": 1739865633           [Unix — preserved]          │
│ "LastUpdated": "2026-03-17T03:24:47Z"                           │
│ "LastUpdatedUnix": 1742252687       [Unix — preserved]          │
│                                                                   │
│ GAS normalises to Sheets format (optional EDT conversion):       │
│ → Sheets receives both datetime AND unix                         │
└─────────────────────────────────────────────────────────────────┘
                          ↓ GAS webhook
                    (append/update Sheets)
┌─────────────────────────────────────────────────────────────────┐
│ LAYER 3: GOOGLE SHEETS (Backup)                                 │
│ ─────────────────────────────────────────────────────────────── │
│ Column A: Created              = 2025-02-18T00:27:13Z            │
│ Column B: CreatedUnix          = 1739865633                      │
│ Column C: LastUpdated          = 2026-03-17T03:24:47Z            │
│ Column D: LastUpdatedUnix      = 1742252687                      │
│                                                                   │
│ During sync-back: Use Unix columns to resolve conflicts.         │
└─────────────────────────────────────────────────────────────────┘
```

---

## Implementation Strategy

### Step 1: Ensure MySQL has Unix columns populated

For each datetime column, create a companion Unix timestamp column:

```sql
ALTER TABLE members
ADD COLUMN CreatedUnix BIGINT DEFAULT NULL AFTER Created,
ADD COLUMN LastUpdatedUnix BIGINT DEFAULT NULL AFTER LastUpdated,
ADD COLUMN LastLoginUnix BIGINT DEFAULT NULL AFTER LastLogin,
ADD COLUMN PaymentDateUnix BIGINT DEFAULT NULL AFTER PaymentDate;

-- Populate from existing datetime columns
UPDATE members
SET CreatedUnix = UNIX_TIMESTAMP(Created)
WHERE Created IS NOT NULL;

UPDATE members
SET LastUpdatedUnix = UNIX_TIMESTAMP(LastUpdated)
WHERE LastUpdated IS NOT NULL;

-- Similar for LastLoginUnix, PaymentDateUnix
```

### Step 2: Update Python Serialization (MySQL → JSON)

In `mmr-admin/api_sheets_sync.py`, when serializing rows for GAS:

```python
def _serialize_rows(rows: List[Dict[str, Any]]) -> List[Dict[str, str]]:
    """
    Convert MySQL rows to JSON-serializable dicts.

    For each datetime column, include both:
      - Human-readable ISO string
      - Unix timestamp (integer)

    GAS will push both to Sheets.
    """
    serialized = []
    for row in rows:
        r = {}
        for key, val in row.items():
            if val is None:
                r[key] = None
            elif isinstance(val, datetime):
                # DateTime column → serialize as ISO string
                r[key] = val.isoformat() + 'Z'  # e.g., '2025-02-18T00:27:13Z'
            elif isinstance(val, date):
                r[key] = val.isoformat()  # date-only: '2025-02-18'
            elif isinstance(val, Decimal):
                r[key] = float(val)
            else:
                r[key] = val
        serialized.append(r)
    return serialized
```

**Note:** Unix columns (integers) serialize as-is. No special handling needed.

### Step 3: GAS Webhook Updates

In Google Apps Script (`basecamp/google/Code.gs`), when appending/updating rows:

1. **Accept Unix columns** from MySQL
2. **Sync both datetime AND unix** to Sheets
3. **Optional:** Use GAS to compute one from the other for redundancy

Example GAS snippet:

```javascript
function appendMembers(rows) {
  const sheet = SpreadsheetApp.getActiveSheet();

  // rows come from Python with both datetime strings and unix timestamps
  // e.g., row = { Created: '2025-02-18T00:27:13Z', CreatedUnix: 1739865633, ... }

  for (const row of rows) {
    // If datetime is missing but unix is present, compute it:
    if (!row.Created && row.CreatedUnix) {
      const dt = new Date(row.CreatedUnix * 1000);
      row.Created = dt.toISOString().slice(0, 19) + 'Z';  // ISO format
    }

    // If unix is missing but datetime is present, compute it:
    if (row.Created && !row.CreatedUnix) {
      row.CreatedUnix = Math.floor(new Date(row.Created).getTime() / 1000);
    }

    // Append row to sheet
    sheet.appendRow([row.MemberID, row.Created, row.CreatedUnix, ...]);
  }
}
```

### Step 4: Sync Back Logic (Sheets → MySQL)

In `sync_engine.py`, the comparison logic **already has Unix timestamp support**:

```python
# From sync_engine.py line 346–439
# _compare_timestamp_logic() uses UNIX_TIMESTAMP_MAPPING
# Falls back to datetime comparison if Unix columns not found
```

**But you must:**

1. Ensure Sheets columns include both datetime AND unix
2. Ensure `UNIX_TIMESTAMP_MAPPING` is kept in sync with your schema
3. During `sheets_to_mysql` sync, pass the Unix columns to the comparison function

Example:

```python
# In api_sheets_sync.py (Google → MySQL sync)
result = compare_sync_rows(
    primary_key='MemberID',
    key_value=member_id,
    mysql_row=member,
    sheets_row=sheets_member,
    compare_cols=MEMBERS_SYNC_COLUMNS,
    ts_col='LastUpdated',  # Primary timestamp column
    direction='sheets_to_mysql',  # Sheets → MySQL: Sheets wins
    verbose=verbose_mode,
)
# The comparison will automatically use LastUpdatedUnix if present in both rows
```

---

## Sync Logic Summary

### MySQL → Sheets (One-way, MySQL wins)

1. Query all members from MySQL (includes both `Created` and `CreatedUnix`, etc.)
2. Serialize to JSON (both datetime strings and unix integers)
3. Send to GAS webhook `append_members` / `update_members`
4. GAS syncs both columns to Sheets
5. **Conflict resolution:** Skipped (MySQL always wins in `mysql_to_sheets` direction)

### Sheets → MySQL (Bidirectional, newer wins)

1. Fetch all members from Sheets (includes both datetime strings and unix integers)
2. Compare with MySQL using `_compare_timestamp_logic()`:
   - If **both have unix**: compare integer values (timezone-agnostic) ✅
   - If **one missing unix**: fall back to datetime parse + UTC normalize
   - If **both missing unix**: log warning, skip conflict resolution
3. Winner writes to loser:
   - If MySQL newer: copy `Created`, `LastUpdated`, etc. (datetimes) + `CreatedUnix`, `LastUpdatedUnix`, etc. (unix)
   - If Sheets newer: copy back (less common, but supported)
4. **Keep both in sync:** Always update both datetime AND unix on the losing side

---

## Column Definition Template

Create a new file `basecamp/python/column_definitions.py`:

```python
"""
Column metadata for datetime sync.
Centralized definition of which columns are datetimes and their Unix counterparts.
"""

from typing import Dict, Dict

DATETIME_COLUMNS: Dict[str, Dict[str, Dict[str, str]]] = {
    'members': {
        'Created': {
            'unix_col': 'CreatedUnix',
            'description': 'Account creation timestamp (UTC)',
        },
        'LastUpdated': {
            'unix_col': 'LastUpdatedUnix',
            'description': 'Last record modification timestamp (UTC)',
        },
        'LastLogin': {
            'unix_col': 'LastLoginUnix',
            'description': 'Last webapp login timestamp (UTC)',
        },
        'PaymentDate': {
            'unix_col': 'PaymentDateUnix',
            'description': 'Most recent payment date (UTC)',
        },
        'Expiration': {
            'unix_col': 'ExpirationUnix',
            'description': 'Membership expiration date (UTC)',
        },
    },
    'payments': {
        'ProcessedDate': {
            'unix_col': 'ProcessedDateUnix',
            'description': 'Payment processing timestamp (UTC)',
        },
    },
    'webapp_events': {
        'UpdatedAt': {
            'unix_col': 'UpdatedAtUnix',
            'description': 'Event last update timestamp (UTC)',
        },
    },
}

def get_unix_column(table: str, datetime_col: str) -> str:
    """Return Unix column name for a given datetime column, or None if not found."""
    if table in DATETIME_COLUMNS and datetime_col in DATETIME_COLUMNS[table]:
        return DATETIME_COLUMNS[table][datetime_col]['unix_col']
    return None

def get_datetime_columns(table: str) -> List[str]:
    """Return all datetime column names for a table."""
    if table not in DATETIME_COLUMNS:
        return []
    return list(DATETIME_COLUMNS[table].keys())
```

Then use in `sync_engine.py`:

```python
from column_definitions import get_unix_column, get_datetime_columns

# Before syncing, ensure both datetime and unix columns are included
datetime_cols = get_datetime_columns('members')
unix_cols = [get_unix_column('members', col) for col in datetime_cols]

compare_cols = MEMBERS_SYNC_COLUMNS | set(unix_cols)
```

---

## Testing Checklist

- [ ] MySQL schema has Unix columns for all datetime columns
- [ ] `_serialize_rows()` includes both datetime strings and unix integers
- [ ] GAS webhook accepts both formats and syncs both to Sheets
- [ ] Sheets has both datetime and unix columns populated
- [ ] `UNIX_TIMESTAMP_MAPPING` in `sync_engine.py` is complete
- [ ] `_compare_timestamp_logic()` comparison is called during Sheets→MySQL sync
- [ ] Test case: MySQL `Created=2025-02-18T00:27:13Z, CreatedUnix=1739865633` vs Sheets `Created='2025-02-18T05:27:13Z, CreatedUnix=1739865633'` → resolves as **equal** (unix wins)
- [ ] Test case: After sync, both MySQL and Sheets have matching unix values

---

## Migration Path (for existing data)

1. Add Unix columns to MySQL schema (see Step 1)
2. Populate Unix columns from existing datetime values
3. Sync MySQL to Sheets (pushes both datetime + unix)
4. Verify Sheets Unix columns are populated
5. Update GAS to handle both (will compute missing one from the other)
6. Run bidirectional sync → should now resolve conflicts correctly using Unix timestamps

---

## Why This Works

| Issue | Root Cause | Solution |
|-------|-----------|----------|
| Datetime timezone mismatch | EDT stored as Z in Sheets, UTC in MySQL | Use Unix (timezone-agnostic) for comparison |
| Ambiguous ISO strings | 'Z' means UTC but data is EDT | Store both formats; Unix is authoritative |
| Rounding/fractional seconds | `microseconds` lost in JSON | Unix is integer (no fractional seconds) |
| GAS serialization issues | Browser local time → JSON → Sheets | Both formats stored; GAS can recompute one from other |

**Result:** Sync logic is **unambiguous, timezone-agnostic, and resilient to format differences**.
