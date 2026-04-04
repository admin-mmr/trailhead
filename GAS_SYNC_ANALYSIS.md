# GAS Membership Sheet Sync - Analysis Report

## 1. Sync Job Configuration

Based on code analysis of `web-apps/gas/membership/src/webhook.ts` and `config.ts`:

| Job | Sheet ID | Sheet Name | Key Field | Direction |
|-----|----------|-----------|-----------|-----------|
| import/transactions | `1rVOvhXzSxCRpWdAw3jYq5tWrYdCYtXmfqblTHP_wPqA` | Active | MessageId | Sheets→MySQL |
| import/members | `11SFvgApmDtEv4jz5bTYI9_zEhCFMQAXC4b2z_4s3ljk` | Main | MemberID | Sheets→MySQL |
| export/transactions-meta | `1rVOvhXzSxCRpWdAw3jYq5tWrYdCYtXmfqblTHP_wPqA` | Active | MessageId | MySQL→Sheets |
| **export/members** | `11SFvgApmDtEv4jz5bTYI9_zEhCFMQAXC4b2z_4s3ljk` | **SQL Members** | **MemberID** | **MySQL→Sheets** |
| export/payments | `11SFvgApmDtEv4jz5bTYI9_zEhCFMQAXC4b2z_4s3ljk` | SQL Payments | PaymentID | MySQL→Sheets |
| export/submission | `11SFvgApmDtEv4jz5bTYI9_zEhCFMQAXC4b2z_4s3ljk` | SQL Submissions | SubmissionID | MySQL→Sheets |

## 2. The Problem: Appending Instead of Overriding

### Current `handleWriteRange()` Logic (lines 803-840)

```typescript
function handleWriteRange(payload: any): GoogleAppsScript.Content.TextOutput {
  const { sheetName, rows, overwrite } = payload;

  try {
    const sheet = getSheet(sheetName);

    if (overwrite) {
      // Clear all data and write fresh
      const lastRow = sheet.getLastRow();
      const lastCol = sheet.getLastColumn();
      if (lastRow > 1) {
        sheet.deleteRows(2, lastRow - 1); // Keep header
      }
    }

    let inserted = 0;
    let updated = 0;

    // Append each row - ALWAYS APPENDS
    for (const row of rows) {
      if (Array.isArray(row)) {
        sheet.appendRow(row);  // ← NO KEY-BASED MATCHING
        inserted++;
      }
    }

    console.log(`[webhook] write_range: wrote ${inserted} rows to "${sheetName}"`);
    return jsonResponse({ ok: true, data: { inserted, updated } });
  }
}
```

**Issue:** The function **always uses `appendRow()`**, which means:
- ✅ If `overwrite: true` → clears old data, then appends (works)
- ❌ If `overwrite: false` → **appends every row, creating duplicates** even if MemberID exists

### Why This Breaks export/members

When MySQL syncs to "SQL Members" sheet:
1. Python calls `handleWriteRange()` with `overwrite: false` or missing
2. GAS **appends** all member rows instead of matching by key (MemberID)
3. If A0001 exists in row 2 and sync sends 100 members including A0001 again → A0001 gets appended as row 102
4. Sheet now has duplicate A0001 rows, not an update

## 3. How Other Handlers Do It (Reference)

### `handleUpdateMembers()` (lines 427-480) - CORRECT PATTERN
```typescript
for (const row of rows) {
  const memberId = row.MemberID || row.memberID;
  let found = false;

  for (let i = 1; i < data.length; i++) {
    const sheetMemberId = String(data[i][MM_COL.MEMBER_ID] || '').trim();
    if (sheetMemberId === String(memberId).trim()) {
      // FOUND: update existing row
      const sheetRow = memberObjectToRow(row);
      for (let j = 0; j < sheetRow.length; j++) {
        sheet.getRange(i + 1, j + 1).setValue(sheetRow[j]);
      }
      found = true;
      break;
    }
  }
}
```

This correctly:
- ✅ Finds existing rows by key (MemberID)
- ✅ Updates in-place instead of appending
- ✅ Prevents duplicates

## 4. The Fix

### Option A: Smart Upsert (Recommended)
Modify `handleWriteRange()` to detect and use the key field:

```typescript
function handleWriteRange(payload: any): GoogleAppsScript.Content.TextOutput {
  const { sheetName, rows, overwrite, keyField } = payload;

  if (overwrite) {
    // Clear all data and write fresh
    const lastRow = sheet.getLastRow();
    if (lastRow > 1) {
      sheet.deleteRows(2, lastRow - 1); // Keep header
    }
    // Then append all
    for (const row of rows) {
      sheet.appendRow(row);
    }
  } else if (keyField) {
    // UPSERT mode: match by key, update existing or append new
    const data = sheet.getDataRange().getValues();
    const keyColIndex = getKeyColumnIndex(sheetName, keyField);

    for (const newRow of rows) {
      const keyValue = newRow[keyColIndex];
      let found = false;

      // Search for existing row by key
      for (let i = 1; i < data.length; i++) {
        if (String(data[i][keyColIndex]) === String(keyValue)) {
          // Update existing row
          for (let j = 0; j < newRow.length; j++) {
            sheet.getRange(i + 1, j + 1).setValue(newRow[j]);
          }
          found = true;
          break;
        }
      }

      // If not found, append
      if (!found) {
        sheet.appendRow(newRow);
      }
    }
  } else {
    // Fallback: append (original behavior)
    for (const row of rows) {
      sheet.appendRow(row);
    }
  }
}
```

### Option B: Require `overwrite: true` Always
Change Python sync to always send `overwrite: true` for SQL sync sheets.
- Simpler but requires Python changes
- Less efficient if only a few rows changed

## 5. Testing the Fix

After implementing the fix, verify with:

```typescript
// Test 1: Append new members
handleWriteRange({
  action: 'write_range',
  sheetName: 'SQL Members',
  rows: [[A0001, ...], [A0002, ...]],
  keyField: 'MemberID',
  overwrite: false
});
// Expected: 2 new rows appended

// Test 2: Update existing members
handleWriteRange({
  action: 'write_range',
  sheetName: 'SQL Members',
  rows: [[A0001, 'updated_field', ...]],  // A0001 already exists
  keyField: 'MemberID',
  overwrite: false
});
// Expected: Row with A0001 updated in-place, NO duplicate

// Test 3: Mixed insert + update
handleWriteRange({
  action: 'write_range',
  sheetName: 'SQL Members',
  rows: [[A0001, ...], [A0999, ...]],  // A0001 exists, A0999 is new
  keyField: 'MemberID',
  overwrite: false
});
// Expected: A0001 updated, A0999 appended
```

## 6. Required Changes

### In `web-apps/gas/membership/src/webhook.ts`:

1. **Add key column lookup function** (after line 840):
```typescript
function getKeyColumnIndex(sheetName: string, keyField: string): number {
  if (sheetName === 'SQL Members' && keyField === 'MemberID') {
    return 0; // First column is MemberID
  }
  if (sheetName === 'SQL Payments' && keyField === 'PaymentID') {
    return 0; // First column is PaymentID
  }
  if (sheetName === 'SQL Submissions' && keyField === 'SubmissionID') {
    return 0; // First column is SubmissionID
  }
  if (sheetName === 'Active' && keyField === 'MessageId') {
    return 0; // First column is MessageId (Fetch-Gmail sheet)
  }
  return 0; // Default to first column
}
```

2. **Rewrite `handleWriteRange()`** (lines 803-840) to implement upsert logic above.

## 7. Verification Checklist

- [ ] Implement key-based upsert in `handleWriteRange()`
- [ ] Add `getKeyColumnIndex()` helper
- [ ] Re-compile TypeScript: `npm run build`
- [ ] Test with export/members (should update, not append)
- [ ] Test with export/payments (should update, not append)
- [ ] Verify "SQL Members" sheet has no duplicate MemberID rows
- [ ] Monitor GAS Execution logs for successful runs

---

**Summary:** The `handleWriteRange()` function always appends rows instead of matching by key. For `export/members`, this causes duplicate rows for the same MemberID. The fix is to implement upsert logic that matches by key (MemberID, PaymentID, etc.) and updates existing rows instead of appending duplicates.
