# Gmail Transaction Import — Debug Guide

## Quick Workflow: See What's Being Read & Compare

### Step 1: Run Import in Admin Portal

1. Go to **Admin Portal** → **Sync** tab → **📥 Import Transactions**
2. Click **Import from Google**
3. Wait for completion (will show "✅ Done")

### Step 2: View Detailed Log

In the sync panel, find your job and click **View Log** to expand:

```
📥 Fetched 127 transactions from Google Sheets
   Columns: MessageId, Memo, ProcessedTime, WebAppID
   [Row 1] MessageId=msg_abc123, Memo='Payment for 5K', ProcessedTime=2026-03-31T10:30:00, WebAppID=WEB-001
   [Row 2] MessageId=msg_def456, Memo='Race registration', ProcessedTime=2026-03-31T11:00:00, WebAppID=WEB-002
   [Row 3] MessageId=msg_ghi789, Memo='Late entry fee', ProcessedTime=2026-03-31T11:15:00, WebAppID=WEB-003
...
✅ msg_abc123: INSERTED (new)
🔄 msg_existing789: UPDATED — Memo changed: 'Old note' → 'Updated memo'
⊘ msg_existing012: skipped — Memo matches Notes: 'No change'
✅ Import Complete: 12 inserted, 5 updated, 110 skipped, 0 errors
```

**Key insights:**
- **First 5 rows** show exactly what was read from Google
- **✅ INSERTED** = New transaction added
- **🔄 UPDATED** = Memo in Google differs from Notes in MySQL
- **⊘ skipped** = Already matches, no change needed

### Step 3: Compare with MySQL Using Python Code

Go to **Admin Portal** → **Python Code** tab and paste:

```python
# What's in MySQL for gmail_transactions?
results = query("""
  SELECT
    COUNT(*) as total,
    SUM(CASE WHEN ProcessedTime IS NOT NULL THEN 1 ELSE 0 END) as processed,
    SUM(CASE WHEN ProcessedTime IS NULL THEN 1 ELSE 0 END) as unprocessed
  FROM gmail_transactions
""")

row = results[0]
print(f"Total transactions in MySQL: {row['total']}")
print(f"  - Processed: {row['processed']}")
print(f"  - Unprocessed: {row['unprocessed']}")
```

### Step 4: Find Specific Transactions

Compare what Google sent vs what's in MySQL:

```python
# Show recent transactions (from Google)
from datetime import datetime, timedelta

recent = datetime.utcnow() - timedelta(days=1)

results = query("""
  SELECT MessageId, Memo, Notes, ProcessedTime, WebAppID, created_at
  FROM gmail_transactions
  WHERE created_at > %s
  ORDER BY created_at DESC
  LIMIT 10
""", [recent.isoformat()])

print(f"Last 10 transactions in MySQL:")
for txn in results:
    print(f"  {txn['MessageId'][:20]}...")
    print(f"    Memo: {repr(txn['Memo'][:30])}")
    print(f"    Notes: {repr(txn['Notes'][:30])}")
    print(f"    ProcessedTime: {txn['ProcessedTime']}")
    print()
```

### Step 5: Find Mismatches

See which transactions have different Memo vs Notes (potential update issues):

```python
results = query("""
  SELECT MessageId, Memo, Notes
  FROM gmail_transactions
  WHERE Memo IS NOT NULL AND Memo != Notes
  ORDER BY updated_at DESC
  LIMIT 20
""")

print(f"Found {len(results)} transactions where Memo ≠ Notes:")
for txn in results:
    print(f"  {txn['MessageId']}")
    print(f"    Memo (Google):  {repr(txn['Memo'])}")
    print(f"    Notes (MySQL):  {repr(txn['Notes'])}")
    print()
```

## Interpretation Guide

### What You'll See in the Log

```
📥 Fetched 127 transactions from Google Sheets
```
- Google Sheets webhook returned 127 rows
- Shows the columns available in the data

```
   [Row 1] MessageId=msg_abc123, Memo='Payment for 5K', ProcessedTime=2026-03-31T10:30:00, WebAppID=WEB-001
   [Row 2] MessageId=msg_def456, Memo='Race registration', ProcessedTime=2026-03-31T11:00:00, WebAppID=WEB-002
   [Row 3] MessageId=msg_ghi789, Memo='Late entry fee', ProcessedTime=2026-03-31T11:15:00, WebAppID=WEB-003
```
- First 5 rows are logged so you can verify data structure
- Memo is the key field that gets compared
- ProcessedTime and WebAppID are recorded but don't trigger updates

```
📥 Found 120 existing transactions in MySQL
```
- 120 transactions already in the database
- 127 from Google - 120 existing = 7 new transactions expected

```
✅ msg_abc123: INSERTED (new)
   → Memo='Payment for 5K', ProcessedTime=2026-03-31T10:30:00
```
- Transaction is NEW (MessageId not found in MySQL)
- Will be inserted with the Memo, ProcessedTime, WebAppID shown
- Notes field is left empty (only Memo → Notes conversion on existing updates)

```
🔄 msg_existing789: UPDATED — Memo changed: 'Old note' → 'Updated memo'
```
- Transaction exists in MySQL
- Memo in Google differs from Notes in MySQL
- Notes will be updated to match the Memo from Google

```
⊘ msg_existing012: skipped — Memo matches Notes: 'No change'
```
- Transaction exists in MySQL
- Memo and Notes already match
- No update needed, row skipped

```
⊘ msg_existing345: skipped — Both Memo and Notes empty — no change
```
- Transaction exists but both fields are empty
- Nothing to update, row skipped

```
✅ Import Complete: 12 inserted, 5 updated, 110 skipped, 0 errors
```
- **12 inserted** = New rows added to MySQL
- **5 updated** = Existing rows where Memo changed
- **110 skipped** = Existing rows with no changes
- **0 errors** = All operations succeeded

## Troubleshooting

### Issue: 0 Inserted, 0 Updated, All Skipped

**Probable cause:** All transactions already in MySQL with matching Memo/Notes

**Check:**
```python
# Count existing vs new
mysql_count = query("SELECT COUNT(*) as cnt FROM gmail_transactions")[0]['cnt']
print(f"Total in MySQL: {mysql_count}")

# Check the last import log
logs = query("""
  SELECT raw_row_count, inserted, updated, skipped
  FROM sync_log
  WHERE action = 'transaction_import'
  ORDER BY created_at DESC LIMIT 1
""")
log = logs[0]
print(f"Google sent: {log['raw_row_count']}")
print(f"Inserted: {log['inserted']}, Updated: {log['updated']}, Skipped: {log['skipped']}")
print(f"Total processed: {log['inserted'] + log['updated'] + log['skipped']}")
```

### Issue: Expected More Rows Inserted

**Probable cause:** Google Sheets data matches existing MySQL data

**Check for duplicates:**
```python
# Find MessageIds in Google that are already in MySQL
# (requires manual cross-reference with Google data)

# But we can check: are all Memo/Notes the same?
results = query("""
  SELECT
    COUNT(*) as total,
    SUM(CASE WHEN Memo = Notes THEN 1 ELSE 0 END) as matching,
    SUM(CASE WHEN Memo != Notes THEN 1 ELSE 0 END) as differing,
    SUM(CASE WHEN Memo IS NULL THEN 1 ELSE 0 END) as null_memo,
    SUM(CASE WHEN Notes IS NULL THEN 1 ELSE 0 END) as null_notes
  FROM gmail_transactions
""")

row = results[0]
print(f"Total: {row['total']}")
print(f"  Memo = Notes: {row['matching']}")
print(f"  Memo ≠ Notes: {row['differing']}")
print(f"  Memo is NULL: {row['null_memo']}")
print(f"  Notes is NULL: {row['null_notes']}")
```

### Issue: Import Failed with Error

**Check the error:**
```python
logs = query("""
  SELECT status, error_message, created_at
  FROM sync_log
  WHERE action = 'transaction_import'
  ORDER BY created_at DESC LIMIT 1
""")

log = logs[0]
print(f"Status: {log['status']}")
if log['status'] == 'error':
    print(f"Error: {log['error_message']}")
```

## Fields Being Compared

| Google Column | MySQL Column | Action | Notes |
|---------------|--------------|--------|-------|
| MessageId | MessageId | Primary Key | Used to find existing row |
| Memo | Notes | Triggers Update | Only if Memo ≠ Notes |
| ProcessedTime | ProcessedTime | Recorded | Doesn't trigger update |
| WebAppID | WebAppID | Recorded | Doesn't trigger update |

**Important:** Memo from Google Sheets → Notes column in MySQL (different names!)

## See Also

- `VERBOSE_IMPORT_LOGGING.md` — Detailed explanation of logging
- `PYTHON_CODE_EDITOR_README.md` — How to write analysis queries
- `SYNC_TAB_ARCHITECTURE.md` — Overall sync design
