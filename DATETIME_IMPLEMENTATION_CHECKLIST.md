# Datetime Sync Implementation Checklist

## Phase 1: Schema Setup (MySQL)

### Add Unix timestamp columns

- [ ] Run migration to add Unix columns:
  ```sql
  ALTER TABLE members
  ADD COLUMN CreatedUnix BIGINT DEFAULT NULL,
  ADD COLUMN LastUpdatedUnix BIGINT DEFAULT NULL,
  ADD COLUMN LastLoginUnix BIGINT DEFAULT NULL,
  ADD COLUMN PaymentDateUnix BIGINT DEFAULT NULL,
  ADD COLUMN ExpirationUnix BIGINT DEFAULT NULL;
  ```

- [ ] Populate from existing datetime columns:
  ```sql
  UPDATE members SET CreatedUnix = UNIX_TIMESTAMP(Created) WHERE Created IS NOT NULL;
  UPDATE members SET LastUpdatedUnix = UNIX_TIMESTAMP(LastUpdated) WHERE LastUpdated IS NOT NULL;
  UPDATE members SET LastLoginUnix = UNIX_TIMESTAMP(LastLogin) WHERE LastLogin IS NOT NULL;
  UPDATE members SET PaymentDateUnix = UNIX_TIMESTAMP(PaymentDate) WHERE PaymentDate IS NOT NULL;
  UPDATE members SET ExpirationUnix = UNIX_TIMESTAMP(Expiration) WHERE Expiration IS NOT NULL;
  ```

- [ ] Add to `payments` table:
  ```sql
  ALTER TABLE payments
  ADD COLUMN ProcessedDateUnix BIGINT DEFAULT NULL;

  UPDATE payments SET ProcessedDateUnix = UNIX_TIMESTAMP(ProcessedDate) WHERE ProcessedDate IS NOT NULL;
  ```

- [ ] Add to `webapp_events` table:
  ```sql
  ALTER TABLE webapp_events
  ADD COLUMN UpdatedAtUnix BIGINT DEFAULT NULL;

  UPDATE webapp_events SET UpdatedAtUnix = UNIX_TIMESTAMP(UpdatedAt) WHERE UpdatedAt IS NOT NULL;
  ```

- [ ] Update `db/schema_snapshot.sql` to reflect new columns

- [ ] Test: Query members; confirm both datetime and unix columns are present
  ```sql
  SELECT MemberID, Created, CreatedUnix, LastUpdated, LastUpdatedUnix FROM members LIMIT 5;
  ```

---

## Phase 2: Python Serialization

### Update `_serialize_rows()` in `mmr-admin/api_sheets_sync.py`

- [ ] Locate `_serialize_rows()` function (around line 500–550)

- [ ] Ensure datetime serialization is clean:
  ```python
  def _serialize_rows(rows: List[Dict[str, Any]]) -> List[Dict[str, str]]:
      """Convert MySQL rows to JSON-serializable format."""
      serialized = []
      for row in rows:
          r = {}
          for key, val in row.items():
              if val is None:
                  r[key] = None
              elif isinstance(val, datetime):
                  # Ensure UTC: .isoformat() + 'Z'
                  r[key] = val.isoformat() + 'Z'
              elif isinstance(val, date):
                  r[key] = val.isoformat()
              elif isinstance(val, Decimal):
                  r[key] = float(val)
              else:
                  r[key] = val
          serialized.append(r)
      return serialized
  ```

- [ ] Test locally:
  ```python
  from datetime import datetime
  from decimal import Decimal

  test_row = {
      'MemberID': 'A0001',
      'Created': datetime(2025, 2, 18, 0, 27, 13),
      'CreatedUnix': 1739865633,
      'MembershipFeePaid': Decimal('50.00'),
  }

  result = _serialize_rows([test_row])
  print(result)
  # Expected: [{'MemberID': 'A0001', 'Created': '2025-02-18T00:27:13Z', 'CreatedUnix': 1739865633, ...}]
  ```

---

## Phase 3: Google Apps Script Updates

### Update `basecamp/google/Code.gs` webhook handlers

- [ ] Locate `appendMembers(rows)` function

- [ ] Add fallback logic to compute missing datetime/unix:
  ```javascript
  function appendMembers(rows) {
    const sheet = SpreadsheetApp.getActiveSheet();

    for (const row of rows) {
      // Sync both formats; compute missing one from the other

      // If datetime missing, compute from unix
      if (!row.Created && row.CreatedUnix) {
        const dt = new Date(row.CreatedUnix * 1000);
        row.Created = dt.toISOString().slice(0, 19) + 'Z';
      }

      // If unix missing, compute from datetime
      if (row.Created && !row.CreatedUnix) {
        row.CreatedUnix = Math.floor(new Date(row.Created).getTime() / 1000);
      }

      // Similar for LastUpdated, LastLogin, PaymentDate, Expiration
      // ... (repeat for all datetime columns)

      sheet.appendRow([
        row.MemberID,
        row.Created,
        row.CreatedUnix,
        row.Status,
        // ... other columns
      ]);
    }
  }
  ```

- [ ] Similarly update `updateMembers(rows)` function

- [ ] Test: Manually append a row via GAS; verify both datetime and unix are written to Sheets

---

## Phase 4: Column Definitions (Python)

### Create `basecamp/python/column_definitions.py`

- [ ] Create file with metadata:
  ```python
  DATETIME_COLUMNS: Dict[str, Dict[str, Dict[str, str]]] = {
      'members': {
          'Created': {'unix_col': 'CreatedUnix', 'description': '...'},
          'LastUpdated': {'unix_col': 'LastUpdatedUnix', 'description': '...'},
          'LastLogin': {'unix_col': 'LastLoginUnix', 'description': '...'},
          'PaymentDate': {'unix_col': 'PaymentDateUnix', 'description': '...'},
          'Expiration': {'unix_col': 'ExpirationUnix', 'description': '...'},
      },
      'payments': {
          'ProcessedDate': {'unix_col': 'ProcessedDateUnix', 'description': '...'},
      },
      'webapp_events': {
          'UpdatedAt': {'unix_col': 'UpdatedAtUnix', 'description': '...'},
      },
  }
  ```

- [ ] Test import: `python3 -c "from basecamp.python.column_definitions import DATETIME_COLUMNS; print(DATETIME_COLUMNS)"`

---

## Phase 5: Sync Engine Integration

### Update `basecamp/python/sync_engine.py`

- [ ] Ensure `UNIX_TIMESTAMP_MAPPING` is complete and includes all new columns (line 370–387):
  ```python
  UNIX_TIMESTAMP_MAPPING: Dict[str, Dict[str, str]] = {
      'members': {
          'Created': 'CreatedUnix',
          'LastUpdated': 'LastUpdatedUnix',
          'LastLogin': 'LastLoginUnix',
          'PaymentDate': 'PaymentDateUnix',
          'Expiration': 'ExpirationUnix',
      },
      # ... rest of tables
  }
  ```

- [ ] Verify `_compare_timestamp_logic()` (line 346–440) uses the mapping correctly

- [ ] Test: Run a mock bidirectional sync with both datetime and unix columns present
  ```python
  from sync_engine import compare_sync_rows, _compare_timestamp_logic

  mysql_row = {
      'MemberID': 'A0001',
      'Created': datetime(2025, 2, 18, 0, 27, 13),
      'CreatedUnix': 1739865633,
  }

  sheets_row = {
      'MemberID': 'A0001',
      'Created': '2025-02-18T05:27:13.000Z',  # EDT local time (wrong)
      'CreatedUnix': 1739865633,              # Correct (Unix is authoritative)
  }

  result = compare_sync_rows(
      primary_key='MemberID',
      key_value='A0001',
      mysql_row=mysql_row,
      sheets_row=sheets_row,
      compare_cols=['Created', 'CreatedUnix'],
      ts_col='Created',
      direction='bidirectional',
  )

  # Expected: MATCH (unix timestamps are equal, datetime mismatch ignored)
  print(f"Result: {result.action}")  # Should be MATCH
  ```

---

## Phase 6: API Updates

### Update `mmr-admin/api_sheets_sync.py`

- [ ] In `_sync_members_to_sheets()`, ensure unix columns are included in comparison:
  ```python
  # Around line 575
  compare_cols = list(MEMBERS_SYNC_COLUMNS) + ['CreatedUnix', 'LastUpdatedUnix', 'LastLoginUnix', 'PaymentDateUnix', 'ExpirationUnix']

  result = compare_sync_rows(
      primary_key='MemberID',
      key_value=member_id,
      mysql_row=member,
      sheets_row=sheets_member,
      compare_cols=compare_cols,
      ts_col='LastUpdated',
      direction='mysql_to_sheets',
      verbose=verbose_mode,
  )
  ```

- [ ] Test: Run sync job with verbose mode; verify that unix columns are passed through

---

## Phase 7: Testing

### End-to-end test

- [ ] Create test members in MySQL with both datetime and unix populated

- [ ] Run `mysql_to_sheets` sync:
  - Verify Sheets receives both datetime strings and unix integers
  - Verify GAS webhook appends rows correctly

- [ ] Manually edit a Sheets datetime (e.g., change `Created` to wrong time) but keep unix correct

- [ ] Run `sheets_to_mysql` sync (bidirectional):
  - Verify sync correctly identifies this as a MATCH (unix is correct, datetime is ignored)
  - Verify no unnecessary update is triggered

- [ ] Manually change Sheets unix timestamp to be newer than MySQL

- [ ] Run `sheets_to_mysql` sync:
  - Verify sync correctly identifies this as a conflict
  - Verify Sheets wins (newer unix timestamp)
  - Verify MySQL is updated with both datetime and unix from Sheets

---

## Phase 8: Documentation & Handoff

- [ ] Add inline comments to GAS code explaining datetime/unix sync logic

- [ ] Update README/wiki with datetime sync strategy

- [ ] Add troubleshooting section:
  - "How to fix timezone mismatches" → "Use unix columns; recompute datetime from unix if needed"
  - "How to verify sync correctness" → Query both mysql and sheets, compare unix values

- [ ] Schedule review/training with team on new sync logic

---

## Rollback Plan

If issues arise:

1. **Keep old logic running in parallel** during transition
2. **Add feature flag** to `api_sheets_sync.py`:
   ```python
   USE_UNIX_TIMESTAMPS = os.environ.get('USE_UNIX_TIMESTAMPS', 'false').lower() == 'true'

   if USE_UNIX_TIMESTAMPS:
       # New logic with unix columns
   else:
       # Old logic (datetime only)
   ```
3. **Test thoroughly** before removing old logic
4. If rollback needed: disable flag, run sync again with old logic

---

## Success Criteria

✅ Datetime columns are in sync without timezone-related false diffs
✅ Unix timestamps are authoritative for conflict resolution
✅ Both MySQL and Sheets have matching datetime + unix pairs
✅ No more "Created 05:27:13Z vs 00:27:13 UTC" false positives
✅ Sync logs show "MATCH" for identical unix values, even if datetime representation differs
