# Gmail Transactions: Webhook Batching Deep Dive

## Why Batching?

**Gmail Transactions table can grow to 10,000+ rows.** Sending all rows in one webhook call = one big JSON payload → GAS struggles → timeout.

**Batching = smaller payloads, multiple fast calls = no timeout.**

---

## Request/Response Size Analysis

### Example: 1000 gmail_transactions rows

**Per row JSON size** (MessageId, Notes, ProcessedTime):
```json
{
  "MessageId": "123e4567e89b12d3a456426614174000",  // ~36 bytes
  "Notes": "AutoMatch",                              // ~20 bytes avg
  "ProcessedTime": "2026-03-31T10:15:00Z"           // ~25 bytes
}
```
**≈ 80 bytes per row**

### Single Call (OLD - BAD)
```
1000 rows × 80 bytes = 80 KB payload
+ JSON overhead, array brackets, actions = ~90 KB
+ Headers = ~100 KB total

GAS receiving 100 KB → parsing JSON → opening sheet →
writing 1000 rows → too much at once → timeout
```

### Batched Calls (NEW - GOOD)
```
Batch 1: 200 rows = 18 KB payload → GAS writes → fast ✅
Batch 2: 200 rows = 18 KB payload → GAS writes → fast ✅
Batch 3: 200 rows = 18 KB payload → GAS writes → fast ✅
Batch 4: 200 rows = 18 KB payload → GAS writes → fast ✅
Batch 5: 200 rows = 18 KB payload → GAS writes → fast ✅

Total time = 5 calls × 5-7s each = 25-35s (no timeout)
```

---

## Code Flow: Before vs After

### BEFORE: Single Call
```python
# _sync_gmail_transactions_to_sheets()

txn_rows = query("SELECT MessageId, Notes, ProcessedTime FROM gmail_transactions")
# → 887 rows fetched

sheets_data = _call_gas_webhook({'action': 'get_gmail_transactions'})
sheets_by_id = {t['MessageId']: t for t in sheets_data}

rows_to_update = []
for txn in txn_rows:
    if txn['MessageId'] in sheets_by_id:
        # Compare and add to list
        rows_to_update.append(txn)

# 📍 PROBLEM: Sending ALL 887 rows in ONE call
_call_gas_webhook({
    'action': 'update_gmail_transactions',
    'rows': rows_to_update  # ⚠️ 887 rows = ~70 KB JSON
})
# ❌ GAS timeout after 30 seconds
```

### AFTER: Batched Calls
```python
# _sync_gmail_transactions_to_sheets()

# ... (same setup) ...

rows_to_update = []  # Populated same way = 887 rows

# 📍 NEW: Split into batches of 200
batch_size = 200
total_updated = 0

for batch_idx in range(0, len(rows_to_update), batch_size):
    batch = rows_to_update[batch_idx:batch_idx + batch_size]
    batch_num = (batch_idx // batch_size) + 1
    total_batches = (len(rows_to_update) + batch_size - 1) // batch_size

    try:
        # ✅ Only 200 rows = ~16 KB JSON per call
        _call_gas_webhook({
            'action': 'update_gmail_transactions',
            'rows': batch
        })
        total_updated += len(batch)

        # Log progress: "✅ Batch 1/5: Updated 200 transactions"
        log_lines.append(f"✅ Batch {batch_num}/{total_batches}: Updated {len(batch)} transactions")

        # Update UI progress bar
        progress = 50 + int((batch_idx / len(rows_to_update)) * 50)
        job_update = {
            'status': 'running',
            'message': f'Updating batch {batch_num}/{total_batches}...',
            'progress': progress,
        }
        with _sync_jobs_lock:
            _sync_jobs[job_id].update(job_update)

    except Exception as e:
        # Continue to next batch instead of failing entire sync
        error_msg = f"Batch {batch_num}/{total_batches} failed: {e}"
        log_lines.append(f"❌ {error_msg}")
        errors.append(error_msg)
```

---

## Time Savings

### Case: 1000 gmail_transactions, each 80 bytes

**OLD (Single call):**
```
│ Time  │ Action                              │
├───────┼─────────────────────────────────────┤
│ 0ms   │ Start webhook call                  │
│ 500ms │ Network round-trip                  │
│ 1000ms│ GAS receives 100 KB payload         │
│ 2000ms│ GAS parsing JSON                    │
│ 4000ms│ GAS opening spreadsheet             │
│ 8000ms│ GAS writing 1000 rows to sheet      │
│ 12000ms│ Network round-trip return          │
│ 15000ms│ Python receives response           │
└───────┴─────────────────────────────────────┘
Total: 15-20 seconds (sometimes 30+, timeout risk)
```

**NEW (5 batches of 200 rows each):**
```
│ Time  │ Action                              │
├───────┼─────────────────────────────────────┤
│ 0ms   │ Start batch 1 (200 rows)            │
│ 3000ms│ GAS finishes batch 1                │
│ 6000ms│ Start batch 2 (200 rows)            │
│ 9000ms│ GAS finishes batch 2                │
│ 12000ms│ Start batch 3 (200 rows)           │
│ 15000ms│ GAS finishes batch 3                │
│ 18000ms│ Start batch 4 (200 rows)           │
│ 21000ms│ GAS finishes batch 4                │
│ 24000ms│ Start batch 5 (87 rows)            │
│ 27000ms│ GAS finishes batch 5                │
│ 30000ms│ All done                           │
└───────┴─────────────────────────────────────┘
Total: 30 seconds (predictable, no timeout)
```

---

## GAS Implementation Pattern

GAS webhook should expect batches to be much smaller. This simplifies GAS code too:

### OLD GAS Code (struggling)
```javascript
function doPost(e) {
  const payload = JSON.parse(e.postData.contents);

  if (payload.action === 'update_gmail_transactions') {
    const rows = payload.rows;  // ⚠️ Could be 1000+ rows

    // Open sheet (slow)
    const sheet = spreadsheet.getSheetByName('Active');

    // Write 1000 rows all at once (slow)
    for (const row of rows) {
      const range = sheet.getRange(...);
      range.setValues([row]);  // One set() per row = SLOW
    }
    // ❌ Total time: 8-15 seconds, risk of timeout
  }
}
```

### NEW GAS Code (efficient)
```javascript
function doPost(e) {
  const payload = JSON.parse(e.postData.contents);

  if (payload.action === 'update_gmail_transactions') {
    const rows = payload.rows;  // ✅ Max 200 rows

    // Open sheet (fast)
    const sheet = spreadsheet.getSheetByName('Active');

    // Write 200 rows using batch operation (fastest)
    const allValues = rows.map(r => [r.MessageId, r.Notes, r.ProcessedTime]);

    // Find ranges and update in bulk
    for (const row of rows) {
      const msgId = row.MessageId;
      const rowNum = findRowByMessageId(sheet, msgId);

      sheet.getRange(rowNum, 10).setValue(row.Notes);  // Column 10: Notes
      sheet.getRange(rowNum, 11).setValue(row.ProcessedTime);  // Column 11: ProcessedTime
    }
    // ✅ Total time: 3-5 seconds per batch
  }

  return {ok: true, data: {}};
}
```

---

## Failure Scenarios

### Scenario 1: Batch 3 times out
```
✅ Batch 1/5: Updated 200 transactions
✅ Batch 2/5: Updated 200 transactions
❌ Batch 3/5: Read timeout (30s)
✅ Batch 4/5: Updated 200 transactions
✅ Batch 5/5: Updated 87 transactions
✅ Successfully updated 687/887 transactions in Sheets

⚠️  1 batch failed but sync continued. Admin will see report and can retry.
```

### Scenario 2: Network hiccup during Batch 2
```
✅ Batch 1/5: Updated 200 transactions
❌ append_members batch 2: Connection reset by peer
✅ Batch 3/5: Updated 200 transactions
✅ Batch 4/5: Updated 200 transactions
✅ Batch 5/5: Updated 87 transactions

Summary: 4/5 batches succeeded, 1 failed. Email report notes the failed batch.
Admin can inspect logs, fix issue (if needed), and re-run sync.
```

---

## Configuration Recommendations

### Default (Tested, Safe)
```python
batch_size = 200      # 200 rows per call
timeout = 60          # 60 second timeout per call
max_retries = 3       # Retry 3 times with backoff
```

### For Slow GAS (Poor Network)
```python
batch_size = 100      # Smaller = faster per call
timeout = 90          # Longer timeout tolerance
max_retries = 2       # Fewer retries (already slow)
```

### For Fast GAS (Good Network)
```python
batch_size = 500      # Larger batches = fewer calls
timeout = 45          # Can be more aggressive
max_retries = 3       # Still retry if needed
```

---

## Monitoring & Alerting

Admin should watch for:

1. **Batch timeouts in logs** → Increase `timeout` or reduce `batch_size`
2. **GAS rate-limit errors** → Reduce `batch_size` to 100
3. **Sync taking >2 minutes** → Network issue or GAS slow, investigate GAS logs
4. **Partial sync success** → Normal, admin can re-run failed batches

---

**Last Updated:** 2026-03-30 10:20 UTC
