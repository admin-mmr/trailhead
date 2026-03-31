# Python Execution Engine for MMR Admin Portal

## Overview

The Python Execution Engine provides a **safe, read-only way to run diagnostic functions** in Azure without needing localhost access. It's designed specifically for debugging data sync issues and transaction imports.

## Access

- **Tab:** "Python Exec" (visible to `admin` and `super_admin` roles only)
- **Location:** MMR Admin Portal → Python Exec tab
- **API Endpoint:** `/api/py-exec/`

## Available Functions

All functions are **read-only** and execute safely in Azure. Click a function name to see its description.

### 1. `get_sheet_vs_db_counts`
Compare row counts between Google Sheets (via last sync log) and MySQL database.

**Returns:**
- `db_total_rows`: Total transaction rows in MySQL (including deleted)
- `db_active_rows`: Active transaction rows (where `deleted_at IS NULL`)
- `last_fetch_log`: Last sheet fetch sync log entry
- `note`: How to find Google Sheets raw row count

**Use case:** Identify if import is missing rows or failing silently.

---

### 2. `get_sync_status`
Fetch the last 5 sync operations with detailed status.

**Returns:**
- `recent_syncs`: Array of last 5 sync_log entries with:
  - `action`: Type of sync (e.g., `sheet_fetch`, `transaction_import`)
  - `status`: `pending`, `completed`, `failed`
  - `inserted`, `updated`, `errors`: Counts
  - `raw_row_count`: How many rows were in the source
  - `started_at`, `completed_at`: Timestamps
  - `error_message`: If failed, the error text

**Use case:** See what's been happening recently and spot error patterns.

---

### 3. `check_transaction_dups`
Find duplicate transactions (same `bib_id` + same `transaction_date`).

**Returns:**
- `duplicate_groups`: Array of duplicate groups with counts
- `count`: Total number of duplicate groups found

**Use case:** Diagnose why import shows 0 updates (duplicates may have been skipped).

---

### 4. `check_transaction_nulls`
Find transactions with critical NULL values.

**Returns:**
- `null_issues`: Array of issues:
  - `NULL bib_id`
  - `NULL transaction_date`
  - `NULL amount`
- `total_issues`: Sum of all NULL issues

**Use case:** Identify malformed data that failed validation.

---

### 5. `get_sample_transactions`
Fetch the 10 most recent transactions for manual inspection.

**Returns:**
- `samples`: Array of transaction rows with:
  - `id`, `bib_id`, `transaction_date`, `amount`
  - `notes`, `created_at`, `updated_at`
- `count`: Number of samples returned

**Use case:** Quickly inspect actual data to see structure and values.

---

### 6. `test_db_connection`
Test database connectivity and get schema metadata.

**Returns:**
- `connected`: Boolean
- `database`: Current database name
- `tables`: Array of table names with column counts
- `timestamp`: When the check ran

**Use case:** Verify Azure MySQL is accessible and healthy.

---

## How to Use

### In the Browser

1. Go to **Admin Portal** → **Python Exec** tab
2. Select a function from the left sidebar
3. Click **▶ Execute**
4. Wait for results (typically <2 seconds)
5. Results appear in JSON format below
6. Click **📥 Download JSON** to save for reference

### REST API (Direct)

#### List available functions:
```bash
curl -H "Authorization: Bearer YOUR_TOKEN" \
  https://mmr-admin.azurewebsites.net/api/py-exec/list
```

#### Run a function:
```bash
curl -X POST \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  https://mmr-admin.azurewebsites.net/api/py-exec/run/get_sheet_vs_db_counts
```

#### Health check:
```bash
curl -H "Authorization: Bearer YOUR_TOKEN" \
  https://mmr-admin.azurewebsites.net/api/py-exec/health
```

## Debugging the Import Issue

### Your Situation
- 0 inserted, 0 updated after import
- Google Sheets has more lines than MySQL

### Diagnostic Steps

1. **Run `test_db_connection`**
   - Verify Azure MySQL is reachable
   - Check if tables exist

2. **Run `get_sync_status`**
   - Look at the last sync log entry
   - Check `action`, `status`, `raw_row_count`
   - If status is `failed`, check `error_message`

3. **Run `get_sheet_vs_db_counts`**
   - Compare MySQL row count vs the `raw_row_count` in last sync log
   - If raw_row_count is high but db_active_rows is not growing, sync is fetching but not importing

4. **Run `check_transaction_nulls`**
   - If there are NULL issues, validation is blocking imports
   - Data in Google Sheets may be incomplete

5. **Run `check_transaction_dups`**
   - If there are many duplicates, upsert logic may be skipping updates
   - Check if import process is de-duping properly

6. **Run `get_sample_transactions`**
   - Inspect the actual data structure
   - Compare to what you're sending from Google Sheets

### Example Workflow

```
Issue: 0 inserted, 0 updated

→ Run test_db_connection
  ✓ Connected successfully

→ Run get_sync_status
  ✓ Last sync completed, raw_row_count = 450

→ Run get_sheet_vs_db_counts
  ✗ db_active_rows = 0 (but Google Sheets has 450 rows)

→ Run check_transaction_nulls
  ✓ 3 rows with NULL bib_id

→ Conclusion: Sync fetched 450 rows, but 3 failed validation
  Check those 3 rows in Google Sheets for bib_id column
```

## Adding New Functions

To add a diagnostic function:

1. Open `mmr-admin/api_python_exec.py`
2. Create a new function that:
   - Takes no required arguments (or optional kwargs)
   - Returns a dict with `status: 'ok'` or `status: 'error'`
   - Includes appropriate `traceback` on error
3. Add it to the `FUNCTIONS` dict at the bottom
4. Restart the app (auto-reloads in Flask debug mode)

Example:
```python
def get_member_sync_status():
    """Check member sync status."""
    try:
        conn = dbmod.get_db_connection()
        cursor = conn.cursor(dictionary=True)
        # Your query here
        cursor.close()
        conn.close()
        return {'status': 'ok', 'data': result}
    except Exception as e:
        return {'status': 'error', 'error': str(e), 'traceback': traceback.format_exc()}
```

## Security & Limitations

- ✅ All functions are **read-only** (SELECT queries only)
- ✅ Only `admin` and `super_admin` roles can access
- ✅ All functions require authentication (Bearer token)
- ✅ No arbitrary code execution — only pre-registered functions
- ⚠️ Max 5 recent sync logs returned (limit is hardcoded)
- ⚠️ No write operations possible
- ⚠️ Functions execute with the Azure app's DB credentials

## Troubleshooting

### "Function not found"
- Check spelling (case-sensitive)
- Run `/api/py-exec/list` to see available functions

### Connection errors
- Verify Azure MySQL is running
- Check that App Settings contain `DATABASE_URL` or equivalent
- Try `/api/py-exec/health` for diagnostic info

### Authorization errors
- Ensure you're logged in as admin
- Check that token is passed in Authorization header

### Slow response
- Azure MySQL may be under load
- Check Azure Monitor for connection issues
- Some queries (dups, nulls) scan the full table

## Related Documentation

- `SYNC_TAB_ARCHITECTURE.md` — How the sync tab works
- `api_sheets_sync.py` — Google Sheets import implementation
- `db.py` — Database connection helper
