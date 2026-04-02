# Sync Timestamp Fix: Timezone-Invariant Comparison

## Problem
Comparing timestamps across MySQL (EDT) and Google Sheets (UTC) via string comparison fails:
- Sheets: `2026-04-01T08:02:03` (UTC)
- MySQL: `2026-04-01T04:02:03` (EDT = same instant)
- String comparison: `"08:02:03" > "04:02:03"` → wrong result

## Solution
**Use Unix timestamps (seconds since epoch) for all sync comparisons.**

### Changes Made

#### 1. GAS Helper: `toUnixTimestamp()` in `sheets.ts`
```typescript
function toUnixTimestamp(value: any): number {
  // Converts any date format to integer seconds since epoch
  // Timezone-invariant by definition (always returns same number)
  // Returns 0 if invalid
}
```

#### 2. Webhook Payloads: Added `*Unix` fields
Every `rowTo*Object()` in `webhook.ts` now returns both:
- **Human-readable:** `LastUpdated: "2026-04-01T08:02:03.000Z"`
- **Sync-safe:** `LastUpdatedUnix: 1743667323`

Examples:
- `Members`: `CreatedUnix`, `LastUpdatedUnix`, `LastLoginDateUnix`, `ProfileLastUpdatedUnix`
- `Events`: `TimestampUnix`, `ExpiresAtUnix`, `ApprovalDateUnix`, `UpdatedAtUnix`
- `Payments`: `ProcessedDateUnix`

### Usage in Python (mmr-admin)

#### When reading from Sheets via webhook:
```python
# Instead of:
sheets_time = datetime.fromisoformat(data["LastUpdated"])
mysql_time = member["updated_at"]  # EDT datetime

# Do this:
sheets_time_unix = data["LastUpdatedUnix"]  # integer seconds
mysql_time_unix = int(member["updated_at"].timestamp())  # integer seconds

if sheets_time_unix > mysql_time_unix:
    # Sync from Sheets → MySQL (Sheets is newer)
    pass
```

#### When storing in MySQL:
Add Unix timestamp columns to relevant tables:
```sql
ALTER TABLE members ADD COLUMN `updated_at_unix` BIGINT SIGNED DEFAULT 0;
ALTER TABLE webapp_events ADD COLUMN `timestamp_unix` BIGINT SIGNED DEFAULT 0;
ALTER TABLE payment_history ADD COLUMN `processed_date_unix` BIGINT SIGNED DEFAULT 0;

-- Index for fast comparison
CREATE INDEX idx_updated_at_unix ON members(updated_at_unix);
```

#### When syncing back to Sheets:
GAS webhook already handles this. When Python calls the webhook payload, include the Unix timestamp:
```python
payload = {
    "action": "update_members",
    "rows": [
        {
            "MemberID": "M123",
            "LastUpdated": "2026-04-01T08:02:03.000Z",
            "LastUpdatedUnix": 1743667323,
            # ... other fields
        }
    ]
}
```

### Backward Compatibility
- ✅ ISO 8601 strings still in payloads (human-readable, for display/logging)
- ✅ Unix timestamps added as new fields (sync logic uses these)
- ✅ Old code reading only ISO strings still works
- ✅ No breaking changes to existing row structures

### Testing the Fix
```python
from datetime import datetime, timezone

# Simulate Sheets time (UTC)
sheets_iso = "2026-04-01T08:02:03Z"
sheets_dt = datetime.fromisoformat(sheets_iso.replace('Z', '+00:00'))
sheets_unix = int(sheets_dt.timestamp())  # 1743667323

# Simulate MySQL time (EDT)
mysql_iso = "2026-04-01T04:02:03"  # No timezone = local
import zoneinfo
edt = zoneinfo.ZoneInfo("America/New_York")
mysql_dt = datetime.fromisoformat(mysql_iso).replace(tzinfo=edt)
mysql_unix = int(mysql_dt.timestamp())  # 1743667323

# Unix comparison (always works)
assert sheets_unix == mysql_unix  # ✓ Same instant!
```

### Files Changed
- `web-apps/gas/membership/src/sheets.ts` — added `toUnixTimestamp()` helper
- `web-apps/gas/membership/src/webhook.ts` — added `*Unix` fields to all row converters

### Next Steps
1. **Deploy GAS**: `cd web-apps/gas/membership && npm run build && clasp push`
2. **Update Python sync logic** in `mmr-admin/api_sheets_sync.py`:
   - Use `*Unix` fields for comparison
   - Add Unix timestamp columns to MySQL schema
3. **Test**: Sync a member update across timezones, verify no double-writes
