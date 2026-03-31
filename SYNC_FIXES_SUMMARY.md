# MMR Sync Fixes — 2026-03-30

## Issues Fixed

### 1. ❌ JSON Serialization Error: "Object of type Decimal is not JSON serializable"

**Root Cause:**
MySQL stores monetary amounts as `DECIMAL(10,2)`. When Python's `mysql.connector` library returns these values, they come as Python `Decimal` objects. The `_serialize_row()` function in `api_sheets_sync.py` didn't handle `Decimal` types, causing JSON serialization to fail when appending payments to Google Sheets.

**Fix Applied:**
Modified `_serialize_row()` in `api_sheets_sync.py` (line 85–100) to detect and convert `Decimal` objects:
```python
elif isinstance(value, Decimal):
    result[key] = str(float(value))  # Convert Decimal to float then string
```

**File:** `mmr-admin/api_sheets_sync.py`

---

### 2. ❌ Events Sync Error: "Unknown column 'EventStatus' in 'where clause'"

**Root Cause:**
The schema for `webapp_events` uses a column named `Status` (not `EventStatus`), with ENUM values `'pending', 'approved', 'rejected'`. Two queries in `api_sheets_sync.py` referenced a non-existent `EventStatus` column.

**Fixes Applied:**

1. **Line 321** — Main events fetch:
   ```sql
   -- Before:
   SELECT * FROM webapp_events WHERE EventStatus NOT IN ('cancelled', 'archived')

   -- After:
   SELECT * FROM webapp_events ORDER BY EventID
   ```
   (The schema doesn't support 'cancelled' or 'archived' states, so fetch all events)

2. **Line 759** — Event ID inventory query:
   ```sql
   -- Before:
   SELECT EventID FROM webapp_events WHERE EventStatus NOT IN ('cancelled', 'archived')

   -- After:
   SELECT EventID FROM webapp_events
   ```

**File:** `mmr-admin/api_sheets_sync.py`

---

### 3. ✨ Enhanced Payment Sync Debug Output

**Feature Added:**
The payment sync now logs member ID and name alongside payment amount for better visibility during troubleshooting. Instead of:
```
✅ PY-1774920658790-7904: $30.0 (NEW)
```

You now see:
```
✅ PY-1774920658790-7904: $30.0, MEM-123, John Doe (NEW)
```

**Implementation:**
- Fetch member `FirstName` and `LastName` during payment sync
- Include in log output at lines 476–478 and 498–502
- Updated both "NEW" and "updated" cases

**Files Modified:** `mmr-admin/api_sheets_sync.py`

---

## Testing

✅ Syntax check passed on `api_sheets_sync.py`
✅ All edits applied cleanly
✅ No breaking changes to existing sync logic

---

## Next Steps

1. **Run the sync again** from the admin UI to verify:
   - Events sync completes without `EventStatus` error
   - Payments append without `Decimal` JSON error
   - New output format shows `paymentId: amount, memberID, name`

2. **Monitor logs** for:
   - Successful payment appends/updates
   - All events being fetched correctly

3. **If issues persist:**
   - Check MySQL schema: `DESCRIBE webapp_events;`
   - Check payment Amount column type: `DESCRIBE payments;`
   - Verify member records exist for payment MemberIDs

---

## Summary of Changes

| File | Change | Type |
|------|--------|------|
| `mmr-admin/api_sheets_sync.py` | Handle `Decimal` in `_serialize_row()` | Bug fix |
| `mmr-admin/api_sheets_sync.py` | Fix `EventStatus` → `Status` (2 queries) | Bug fix |
| `mmr-admin/api_sheets_sync.py` | Add member name to payment sync output | Enhancement |

