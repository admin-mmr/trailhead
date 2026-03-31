# Python Execution Engine — Quick Start

You can now run Python diagnostic functions directly in Azure to debug your import issue without needing localhost access.

## Access

1. Go to **MMR Admin Portal**
2. Click **Python Exec** tab (near Admins tab)
3. Select function → Click **▶ Execute** → Wait for results

## For Your Import Issue (0 inserted, 0 updated)

Run these functions in order:

### Step 1: Verify connection
```
test_db_connection
→ Should show: connected = True, database = "mmr"
```

### Step 2: Check recent syncs
```
get_sync_status
→ Look for the last import attempt
→ Check: status, raw_row_count, error_message
```

### Step 3: Compare sheets vs database
```
get_sheet_vs_db_counts
→ Shows: db_total_rows, db_active_rows, last_fetch_log
→ If db_active_rows is 0 but raw_row_count is high → data not being imported
```

### Step 4: Find why data isn't imported
```
check_transaction_nulls
→ If result > 0 → data validation is failing
```

OR

```
check_transaction_dups
→ If result > 0 → duplicates being skipped
```

### Step 5: Inspect actual data
```
get_sample_transactions
→ See the structure and values of rows in DB
```

## Results

Results appear as JSON. Click **📥 Download JSON** to save them locally.

## Example Output

If `get_sheet_vs_db_counts` returns:
```json
{
  "status": "ok",
  "db_total_rows": 0,
  "db_active_rows": 0,
  "last_fetch_log": {
    "raw_row_count": 450,
    "status": "completed"
  }
}
```

→ **This means:** Sheets has 450 rows, but they didn't get inserted into MySQL.
→ **Next:** Run `check_transaction_nulls` to see if validation failed.

## All Available Functions

1. `test_db_connection` — Verify Azure MySQL is accessible
2. `get_sync_status` — Last 5 sync operations
3. `get_sheet_vs_db_counts` — Compare Sheets vs MySQL row counts
4. `check_transaction_dups` — Find duplicate transactions
5. `check_transaction_nulls` — Find NULL values blocking imports
6. `get_sample_transactions` — Inspect actual transaction data

See `mmr-admin/PYTHON_EXEC_README.md` for full details on each function.

## Tips

- All functions are **read-only** — safe to run anytime
- All functions run in **Azure** — no localhost needed
- Results show **timestamps** — can track import progress over time
- **Download JSON** to compare results over multiple runs

## Need Help?

Check `mmr-admin/PYTHON_EXEC_README.md` for full documentation.
