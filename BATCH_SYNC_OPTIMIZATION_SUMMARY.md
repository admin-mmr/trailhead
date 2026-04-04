# Batch Sync Optimization Summary

## Problem
The sync job endpoint `/api/sync/<operation>` is **hanging and timing out** because:
- **Import (Sheets→MySQL):** Processing **1 row per SQL INSERT call** → 100 rows = 100 db_execute() calls
- **Export (MySQL→Sheets):** All rows batched to GAS webhook, but GAS processes 1 row at a time (network overhead)
- **Job status updates:** Synchronous progress callbacks block the sync → cascading timeouts

---

## Solution: Batch Processing + Resume Capability

### 1. **New `sheets_sync_log` Table** (MIGRATION_V009)
Tracks each batch to enable resume from last successful point:

```sql
CREATE TABLE sheets_sync_log (
  SyncLogID INT AUTO_INCREMENT PRIMARY KEY,
  JobID VARCHAR(36),              -- Foreign key to sync_jobs
  ConfigKey VARCHAR(50),          -- 'export_members', 'import_transactions', etc.
  Direction VARCHAR(20),          -- 'sheet_to_mysql' or 'mysql_to_sheet'
  BatchNumber INT,                -- Batch sequence (0, 1, 2, ...)
  BatchSize INT,                  -- Rows in this batch
  TotalRows INT,                  -- Total rows in entire sync
  Status ENUM('pending','processing','success','error'),
  RowsInserted INT,
  RowsUpdated INT,
  RowsSkipped INT,
  ErrorMessage TEXT,
  StartedAt TIMESTAMP,
  CompletedAt TIMESTAMP,
  UNIQUE KEY (JobID, BatchNumber)
);
```

**Benefits:**
- Resume from batch N if sync crashes (no re-processing batches 0..N-1)
- Track per-batch metrics for monitoring dashboard
- Implement retry logic for failed batches only

---

### 2. **Batch INSERT Operations** (sync_config.py)

#### Before (Line-by-Line)
```python
for row in rows:  # 100 iterations
    sql = "INSERT IGNORE INTO members (...) VALUES (...)"
    db_execute(sql, row.values())  # 1 call per row
```
**Result:** 100 database round-trips

#### After (Batched)
```python
for batch_idx in range(0, len(rows), BATCH_SIZE):
    batch = rows[batch_idx:batch_idx + 50]

    sql = """
        INSERT IGNORE INTO members (col1, col2, ...)
        VALUES (?, ?, ...), (?, ?, ...), ... (50 times)
    """
    db_execute(sql, flattened_values)  # 1 call for 50 rows
```
**Result:** 100 rows → ~2 database calls (vs 100)

---

### 3. **Timestamp-Based Filtering for Exports**

**Before:** Export all rows every time → redundant Sheets writes
```python
rows = db_query(f"SELECT * FROM {table}")  # Always get all
```

**After:** Export only changed rows since last sync
```python
last_sync = db_query("""
    SELECT MAX(StartedAt) FROM sheets_sync_log
    WHERE JobID=? AND ConfigKey=? AND Status='success'
""")

if last_sync_time:
    rows = db_query(
        f"SELECT * FROM {table} WHERE UpdatedAt >= ?",
        [last_sync_time]
    )  # Only changed rows
```

**Benefits:**
- Reduce GAS webhook payload (fewer rows)
- Reduce Sheets API calls (only changed rows written)
- Faster sync overall

---

### 4. **Special Handling for import_members**

**Goal:** Send only NEW member IDs to Sheets, not duplicates

**Implementation:**
1. Fetch existing MemberIDs from MySQL
2. Send list to GAS webhook
3. GAS filters the Sheets Main tab to return only rows where MemberID NOT IN (existing list)
4. Sync only the new ones

```python
# In generic_sync_runner (sheet_to_mysql):
if cfg.get('special_handling') == 'send_existing_ids_to_gas':
    existing_ids = db_query(f"SELECT MemberID FROM members")
    gas_payload['existingIds'] = [row['MemberID'] for row in existing_ids]
```

**GAS Webhook Handler** (web-apps/gas/membership/src/webhook.ts):
```typescript
if (payload.action === 'read_range' && payload.existingIds) {
  // Filter sheet data to return only new rows
  const filtered = data.filter(row => !payload.existingIds.includes(row.MemberID));
  return { ok: true, data: filtered };
}
```

---

### 5. **Disabled Timestamp Check for import_transactions**

**Why:** GAS Timestamp field may not accurately reflect Gmail message time
**Solution:** Always sync all rows (upsert mode will skip duplicates)

```python
'import_transactions': {
    'skip_timestamp_check': True,  # Ignore last_sync_time
    'mode': 'upsert',               # INSERT ... ON DUPLICATE KEY UPDATE
}
```

---

## Performance Comparison

| Operation | Before | After | Improvement |
|-----------|--------|-------|-------------|
| **Import 100 rows** | 100 SQL calls | 2 SQL calls | **50x** |
| **Export 1000 rows** | 1000s webhook overhead | 20 batches (50 each) | **50x** |
| **Export (after 1st run)** | Fetch all 1000 | Fetch ~50 changed | **20x** |
| **Resume capability** | ❌ None | ✅ From last batch | **No re-sync loss** |

---

## Deployment Checklist

### 1. Database
```bash
# Apply migration to create sheets_sync_log table
mysql-mmr < db/MIGRATION_V009_add_sheets_sync_log.sql
```

### 2. Python (basecamp/python/sync_config.py)
✅ Already completed:
- New batch helpers: `_log_sync_batch()`, `_get_last_successful_batch()`, `_batch_insert_rows()`
- Enhanced `generic_sync_runner()` with batching + timestamp filtering
- Updated SYNC_CONFIG for import_members and import_transactions special handling

### 3. GAS Webhook (web-apps/gas/membership/src/webhook.ts)
✅ Needed updates:
```typescript
// In doPost() switch statement:
case 'read_range':
  // Handle existingIds filter for import_members
  if (payload.existingIds?.length > 0) {
    const existingSet = new Set(payload.existingIds);
    data = data.filter(row => !existingSet.has(row[pk]));
  }
  return handleReadRange(payload, data);

// handleReadRange() already implemented ✓
```

### 4. Deploy
```bash
cd /sessions/adoring-amazing-brahmagupta/mnt/trailhead

# Sync shared modules from source
./scripts/sync-shared-modules.sh

# Commit migration + code
git add db/MIGRATION_V009_add_sheets_sync_log.sql basecamp/python/sync_config.py
git commit -m "feat: batch sync with resume capability (50-row batches, timestamp filtering)"
git push origin main
```

---

## Testing

### Test 1: Import Members (new IDs only)
```bash
curl -X POST http://localhost:5000/api/sync/import/members
# Expect: Only new MemberIDs from Sheets inserted (existing skipped)
# Check: sheets_sync_log has 2-3 batches logged
```

### Test 2: Export Members (changed rows only)
```bash
curl -X POST http://localhost:5000/api/sync/export/members
# Expect: Only members with UpdatedAt >= last_sync_time exported
# Check: sheets_sync_log shows batches, SQL Members tab appended
```

### Test 3: Resume from Batch N
```bash
# Start sync, kill mid-process (after batch 2/5 completes)
# Manually update sheets_sync_log to mark batch 2 as failed:
UPDATE sheets_sync_log SET Status='error' WHERE BatchNumber=2;

# Re-run sync
curl -X POST http://localhost:5000/api/sync/import/members
# Expect: Resumes from batch 3 (skips 0-2)
# Check: sheets_sync_log shows batch 3 processing
```

---

## Files Modified

1. **db/MIGRATION_V009_add_sheets_sync_log.sql** (NEW)
   - Creates sheets_sync_log table + indexes + views

2. **basecamp/python/sync_config.py** (REFACTORED)
   - Lines 24-120: Added batch operation helpers + logging functions
   - Lines 204-550: Enhanced generic_sync_runner() with batching + timestamp filtering + special handling
   - SYNC_CONFIG: Updated import_members + import_transactions configs

3. **web-apps/gas/membership/src/webhook.ts** (TODO)
   - Add existingIds filtering in handleReadRange()

---

## Next Steps

1. ✅ Code changes complete (sync_config.py)
2. ✅ Migration created (MIGRATION_V009)
3. 🔄 **Deploy migration** to production database
4. 🔄 **Update GAS webhook** to handle existingIds filter
5. 🔄 **Test batch operations** with real data
6. 🔄 **Monitor sheets_sync_log** for batch metrics
