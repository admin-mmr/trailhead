# Python Unix Timestamp Sync Implementation

## Overview
Updated Python sync logic (`mmr-admin` and `basecamp`) to use timezone-invariant Unix timestamps for conflict resolution, fixing issues with comparing MySQL (EDT) and Google Sheets (UTC) timestamps.

---

## Changes Made

### 1. **Database Migration** (0016)
📁 `db/migrations/0016_add_unix_timestamp_columns.sql`

**New columns added:**

**Membership Master (members table):**
```sql
ALTER TABLE members ADD COLUMN `updated_at_unix` BIGINT SIGNED DEFAULT 0;
ALTER TABLE members ADD COLUMN `last_login_date_unix` BIGINT SIGNED DEFAULT 0;
ALTER TABLE members ADD COLUMN `profile_last_updated_unix` BIGINT SIGNED DEFAULT 0;
ALTER TABLE members ADD COLUMN `created_at_unix` BIGINT SIGNED DEFAULT 0;
```

**WebApp Events (webapp_events table):**
```sql
ALTER TABLE webapp_events ADD COLUMN `timestamp_unix` BIGINT SIGNED DEFAULT 0;
ALTER TABLE webapp_events ADD COLUMN `expires_at_unix` BIGINT SIGNED DEFAULT 0;
ALTER TABLE webapp_events ADD COLUMN `approval_date_unix` BIGINT SIGNED DEFAULT 0;
```

**Payment History (payment_history table):**
```sql
ALTER TABLE payment_history ADD COLUMN `processed_date_unix` BIGINT SIGNED DEFAULT 0;
```

**Indices created** for fast lookups:
- `idx_members_updated_at_unix`
- `idx_webapp_events_timestamp_unix`
- `idx_payment_history_processed_date_unix`

**Backfill included:** Migration includes `UPDATE` statements to populate Unix columns from existing ISO datetime columns using `UNIX_TIMESTAMP()`.

### 2. **Sync Engine** (`sync_engine.py`)

✅ Added `resolve_conflict_unix()` function (parallel to existing `resolve_conflict()`)

**Key differences from datetime-based comparison:**
- Takes Unix timestamp integers instead of parsing ISO strings
- Eliminates timezone parsing ambiguity
- **Same logic as original:** newer-wins with Sheets tie-break and 10-second buffer
- Falls back to datetime comparison if Unix columns not available

**Unix column mapping:**
```python
unix_col_map = {
    'members': {
        'LastUpdated': 'LastUpdatedUnix',
        'LastLoginDate': 'LastLoginDateUnix',
        'ProfileLastUpdated': 'ProfileLastUpdatedUnix',
        'CreatedAt': 'CreatedAtUnix',
    },
    'payments': {
        'ProcessedDate': 'ProcessedDateUnix',
    },
    'webapp_events': {
        'Timestamp': 'TimestampUnix',
        'ExpiresAt': 'ExpiresAtUnix',
        'ApprovalDate': 'ApprovalDateUnix',
    },
}
```

✅ Added `_safe_int()` helper to safely convert values to integers

### 3. **API Sync Endpoints** (`api_sheets_sync.py`)

✅ Imported `resolve_conflict_unix` from sync_engine

✅ Updated 3 conflict resolution calls:
1. **Members sync** (line ~563): Uses `_engine_resolve_conflict_unix('members', ...)`
2. **WebApp Events sync** (line ~821): Uses `_engine_resolve_conflict_unix('webapp_events', ...)`
3. **Payments sync** (line ~1019): Uses `_engine_resolve_conflict_unix('payments', ...)`

All three now compare using Unix timestamps instead of ISO datetime parsing.

### 4. **Backfill Helper** (`backfill_unix_timestamps.py`)

📁 `mmr-admin/backfill_unix_timestamps.py` — Standalone Python script for verification/repair

**Usage:**
```bash
cd mmr-admin
python3 backfill_unix_timestamps.py
```

**Functions:**
- `backfill_members()` — Backfills 4 Unix columns in members table
- `backfill_webapp_events()` — Backfills 3 Unix columns in webapp_events table
- `backfill_payment_history()` — Backfills 1 Unix column in payment_history table
- `verify_backfill()` — Checks that all records have Unix timestamps set

**Output example:**
```
[2026-04-01 15:30:42] INFO: Starting Unix timestamp backfill...
[2026-04-01 15:30:42] INFO: Backfilling members table...
[2026-04-01 15:30:43] INFO:   updated_at_unix: updated 245 records
[2026-04-01 15:30:43] INFO: Backfilling webapp_events table...
[2026-04-01 15:30:43] INFO:   timestamp_unix: updated 1203 records
[2026-04-01 15:30:44] INFO: Verifying backfill...
[2026-04-01 15:30:44] INFO:   members.updated_at_unix: ✓ All records have Unix timestamps
```

---

## How It Works

### Old Flow (Broken)
```
Google Sheets (UTC):  "2026-04-01T08:02:03Z"
                           ↓
                    Parse to datetime
                           ↓
                    Compare as datetime objects
                           ↓
MySQL (EDT):          "2026-04-01T04:02:03"
                           ↓
                    Parse to datetime
                           ↓
❌ EDT parsing assumes EDT timezone → datetime mismatch
```

### New Flow (Fixed)
```
Google Sheets:        LastUpdatedUnix = 1743667323
                           ↓
                    Integer comparison (faster, no parsing)
                           ↓
                    1743667323 > 1743667322 ? → YES
                           ↓
MySQL (EDT):          updated_at_unix = 1743667323
                           ↓
                    Same Unix timestamp
                           ↓
✓ Comparison always correct
```

---

## Deployment Checklist

- [ ] **Apply Migration:** Run `0016_add_unix_timestamp_columns.sql` on Azure MySQL
  ```bash
  mysql-mmr < db/migrations/0016_add_unix_timestamp_columns.sql
  ```

- [ ] **Verify Backfill:** Run backfill helper to ensure all records populated
  ```bash
  cd mmr-admin && python3 backfill_unix_timestamps.py
  ```

- [ ] **Deploy Updated Code:** Push updated `sync_engine.py` and `api_sheets_sync.py` to Azure App Service

- [ ] **GAS Deployment:** Deploy GAS code (already done) so Sheets webhook returns Unix fields

- [ ] **Test Sync:** Manually trigger sync to verify Unix-based conflict resolution works
  - Check sync logs for Unix timestamp comparisons
  - Verify no parse_datetime warnings

---

## Conflict Resolution Example

### Scenario
Member updated in both MySQL and Sheets:
- MySQL: `updated_at_unix = 1743667500`
- Sheets: `LastUpdatedUnix = 1743667480` (20 seconds older)

### Resolution
```python
decision = resolve_conflict_unix('members', 'M123', mysql_row, sheets_row)

# Logic:
mysql_unix = 1743667500
sheets_unix = 1743667480
sheets_unix_adjusted = 1743667480 - 10  # Apply 10s buffer = 1743667470
diff = 1743667500 - 1743667470 = 30 seconds

# Decision: MySQL newer → push to Sheets
decision.direction = SyncDecision.MYSQL_WINS
decision.reason = "MySQL newer (Unix): 1743667500 > 1743667470 (adjusted -10s)"
```

---

## Fallback Behavior

If Unix timestamp columns are missing or 0:
- `resolve_conflict_unix()` logs a warning
- Falls back to `resolve_conflict()` (datetime-based comparison)
- Sync continues without errors

This ensures **backward compatibility** — old records without Unix timestamps still sync correctly.

---

## Files Modified
- ✅ `mmr-admin/sync_engine.py` — Added Unix-based conflict resolution
- ✅ `mmr-admin/api_sheets_sync.py` — Updated 3 sync endpoints to use Unix comparison
- ✅ `db/migrations/0016_add_unix_timestamp_columns.sql` — New migration
- ✅ `mmr-admin/backfill_unix_timestamps.py` — Verification/repair script (new)

---

## Python Build Status
✅ No import errors (dependencies: `db`, `sync_engine` already present)
✅ Ready to deploy to Azure App Service
