# Events Sync Improvements: Timestamp Format Handling & Field Diff Detection

## Problem

When syncing `webapp_events` from MySQL → Google Sheets, the comparison logic was:
1. Converting timestamps to **strings** and comparing them lexicographically
2. Not handling different datetime **formats** (ISO 8601 vs other formats)
3. Marking events as "updated" without showing **which field changed**

Result: Even though MySQL had newer data, string comparison could fail if formats differed (e.g., `2026-03-31T12:35:45` vs `2026-03-31 12:35:45`).

## Solution

Added three helper functions to handle datetime comparison properly:

### 1. `_parse_datetime(value)` — Flexible Format Parser

```python
def _parse_datetime(value: Any) -> Optional[datetime]:
    """Parse a datetime from various formats."""
```

Tries multiple formats in order:
- `2026-03-31T12:35:45.123456` (ISO 8601 with microseconds)
- `2026-03-31T12:35:45` (ISO 8601)
- `2026-03-31 12:35:45` (MySQL datetime)
- `2026-03-31` (date only)

Returns a `datetime` object or `None` if unparseable.

### 2. `_datetimes_equal(dt1, dt2)` — Format-Agnostic Comparison

```python
def _datetimes_equal(dt1: Any, dt2: Any) -> bool:
    """Compare two datetime values (handles different formats)."""
```

Features:
- Parses both values using `_parse_datetime()`
- Compares the resulting `datetime` objects
- **1-second tolerance** to handle rounding differences
- Returns `True` if both are `None`

### 3. `_get_field_diffs(mysql_row, sheets_row)` — Field-by-Field Comparison

```python
def _get_field_diffs(mysql_row: Dict, sheets_row: Dict) -> List[str]:
    """Compare two rows and return list of fields that differ."""
```

Features:
- Excludes system fields: `UpdatedAt`, `CreatedAt`, `id`, `_sync_version`
- Detects datetime fields by checking for 'date' or 'time' in field name
- Uses `_datetimes_equal()` for datetime fields (format-agnostic)
- Uses string comparison for other fields
- Returns list of field names that differ

## Updated Events Sync Logic

**Old behavior:**
```
if mysql_ts > sheets_ts:
    rows_to_update.append(event)
    log_lines.append(f"🔄 {event_id}: updated")
```

**New behavior:**
```
mysql_dt = _parse_datetime(mysql_updated)
sheets_dt = _parse_datetime(sheets_updated)

if mysql_dt and sheets_dt:
    if mysql_dt > sheets_dt:
        should_update = True
        diff_fields = _get_field_diffs(event, sheets_event)

# Log shows which fields differ
log_lines.append(f"🔄 {event_id}: {event_name} (EventStartDate, Location)")
```

## Output Changes

### Before:
```
🔄 EV-1774879410109-2533: updated
🔄 EV-1774895096481-6199: updated
📤 Updated batch 1/1: 110 events
```

### After:
```
🔄 EV-1774879410109-2533: Spring Marathon (EventStartDate, EventEndDate)
🔄 EV-1774895096481-6199: 5K Run (Location, EventCapacity)
📤 Updated batch 1/1: 110 events
```

This gives you visibility into **which fields actually changed**, not just that *something* changed.

## Benefits

✅ **Timestamp format-agnostic** — No longer fails on different datetime formats
✅ **Field-level visibility** — Know exactly what changed in each event
✅ **Robust comparison** — 1-second tolerance for rounding differences
✅ **Handles NULL** — Properly compares when one side is missing UpdatedAt
✅ **No false positives** — String comparison bugs eliminated

## Testing

1. Deploy the updated `api_sheets_sync.py`
2. Run event sync via Admin Portal → Sync tab → "Sync Events"
3. Check the sync log:
   - Events should now show which fields differ: `(Field1, Field2, Field3)`
   - If all events show as NEW or are skipped, something is wrong
   - If you see "UpdatedAt (missing in Sheets)", that triggered the update

## Files Modified

- `mmr-admin/api_sheets_sync.py` — Added helper functions + updated event sync logic

## Code Quality

⚠️ **File now 1455 lines** (was 1400) — considers splitting into separate modules:
- `api_sync_members.py`
- `api_sync_events.py`
- `api_sync_payments.py`
- `api_sync_transactions.py`

This is a **future refactor** — current code is functional and well-organized.
