# GAS Webhook Changes for Batch Sync

## Overview
The Google Apps Script webhook needs to be updated to support the new batch sync features:
1. **Batch read/write operations** (already implemented)
2. **Filter rows based on existingIds** (new, for import_members)

---

## Change 1: Filter Rows by existingIds

### Location
`web-apps/gas/membership/src/webhook.ts` — `handleReadRange()` function

### Current Implementation
```typescript
async function handleReadRange(payload: any, data: any[]): Promise<any> {
  // Returns all rows from specified sheet
  return {
    ok: true,
    data: data
  };
}
```

### Updated Implementation
```typescript
async function handleReadRange(payload: any, data: any[]): Promise<any> {
  // Filter to only rows NOT in existingIds (for import_members)
  if (payload.existingIds && Array.isArray(payload.existingIds)) {
    const existingSet = new Set(payload.existingIds);
    const keyField = payload.keyField || 'MemberID';  // Default key field

    const filtered = data.filter(row => {
      const rowKey = row[keyField];
      return rowKey && !existingSet.has(rowKey);
    });

    console.log(`[handleReadRange] Filtered ${data.length} rows → ${filtered.length} new (existingIds=${payload.existingIds.length})`);

    return {
      ok: true,
      data: filtered
    };
  }

  // No filtering: return all rows
  console.log(`[handleReadRange] Returning all ${data.length} rows (no existingIds provided)`);
  return {
    ok: true,
    data: data
  };
}
```

### When It's Used
- **import_members sync:**
  - Python sends payload with `existingIds: [1001, 1002, 1003, ...]` (all MemberIDs already in MySQL)
  - GAS filters the Main sheet to return only NEW members
  - Python inserts only those new rows

### Example Payload
```json
{
  "action": "read_range",
  "sheetName": "Main",
  "columns": ["MemberID", "Status", "Email", ...],
  "existingIds": ["1001", "1002", "1003", "1004", "1005"],
  "keyField": "MemberID"
}
```

### Expected Response
```json
{
  "ok": true,
  "data": [
    [1006, "active", "newmember1@example.com", ...],  // 1006 is NEW
    [1007, "active", "newmember2@example.com", ...]   // 1007 is NEW
    // 1001-1005 filtered out (already in MySQL)
  ]
}
```

---

## Change 2: Batch Write/Read (Already Implemented ✓)

### Existing Implementation
The webhook already batches operations correctly:

**Write (MySQL → Sheets)**
```typescript
case 'write_range':
  // Appends batch of rows to sheet
  const result = await handleWriteRange(payload, sheetData);
  return result;
  // Can be called multiple times for different batches
```

**Read (Sheets → MySQL)**
```typescript
case 'read_range':
  // Returns batch of rows from sheet
  const result = await handleReadRange(payload, sheetData);
  return result;
  // Can be called multiple times with different columns/filters
```

### No Changes Needed For These
- Python already sends batches of 50 rows per webhook call
- GAS processes and returns results correctly
- Multiple calls supported naturally

---

## Testing the Update

### Test Scenario: Import Members with Filter
```bash
# Assume MySQL has members: 1001, 1002, 1003, 1004, 1005
# Assume Sheets Main tab has members: 1001, 1002, 1003, 1004, 1005, 1006, 1007

curl -X POST http://localhost:5000/api/sync/import/members

# Python flow:
# 1. Query MySQL: existing = [1001, 1002, 1003, 1004, 1005]
# 2. Call GAS webhook with existingIds=[1001, 1002, 1003, 1004, 1005]
# 3. GAS filters: returns only [1006, 1007]
# 4. Python inserts 1006, 1007 into MySQL
# 5. sheets_sync_log logs: inserted=2, skipped=0

# Expected result: ✓ Only 2 new rows inserted
```

---

## Deployment Steps

1. **Update GAS webhook** (web-apps/gas/membership/src/webhook.ts)
   - Add existingIds filtering to `handleReadRange()`
   - Test locally

2. **Deploy GAS changes**
   ```bash
   cd web-apps/gas/membership
   npm run deploy  # (or manual GAS deployment)
   ```

3. **Run import_members sync**
   ```bash
   curl -X POST http://localhost:5000/api/sync/import/members
   ```

4. **Verify in sheets_sync_log**
   ```sql
   SELECT * FROM sheets_sync_log
   WHERE ConfigKey='import_members'
   ORDER BY StartedAt DESC
   LIMIT 5;

   -- Should show: Status='success', RowsInserted=N, RowsSkipped=0
   ```

---

## Notes

- ✅ Batching is **already supported** by existing webhook
- ✅ Timestamp filtering for exports **doesn't require GAS changes** (Python-side only)
- ✅ Only `existingIds` filtering is **new** (import_members optimization)
- ✅ All other imports/exports work as-is with batching

---

## Backward Compatibility

- If `existingIds` is not provided → all rows returned (normal behavior)
- If `existingIds` is empty → no filtering applied
- If `keyField` not specified → defaults to 'MemberID'
- **No breaking changes** to existing webhooks
