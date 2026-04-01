

# --- Merged from PYTHON_EXEC_DEBUG_GUIDE.md ---

# Python Execution Engine — Debug & Testing Guide

**Last Updated:** 2026-03-31
**File:** `mmr-admin/api_python_exec.py`
**All functions fixed:** ✅ All `get_db_connection()` calls replaced with `get_conn()`

---

## Overview

The Python Execution Engine provides a safe, sandboxed way to execute diagnostic functions in the Azure admin portal. All 8 functions now include comprehensive debug info to help trace execution flow and identify issues.

---

## Debug Info Added to Every Function

Each function now returns a `debug` object containing:
- **Connection status**: `connected`, `closed`, `error`
- **Queries executed**: List of SQL queries with results
- **Row counts**: How many rows were affected/returned
- **Configuration info**: DB host, user, database name
- **Error types**: If something fails, you get the error class name

All functions also track:
- `execution_time_ms`: Time in milliseconds
- `executed_at`: ISO timestamp
- `error_type`: Python exception class (e.g., `AttributeError`, `MySQLError`)

---

## Functions & Test Checklist

### ✅ 1. `GET /api/py-exec/health`
**Purpose:** Quick system health check (DB connection + function count)

**Expected Response:**
```json
{
  "status": "healthy",
  "db_connected": true,
  "function_count": 8,
  "available_functions": ["get_sheet_vs_db_counts", "get_sync_status", ...],
  "timestamp": "2026-03-31T16:05:00.123456",
  "debug": {
    "checks": {
      "db_config": {"host": "...", "user": "...", "database": "..."},
      "connection_acquired": true,
      "query_executed": true,
      "connection_closed": true
    }
  }
}
```

**Test Command:**
```bash
curl -X GET http://localhost:5000/api/py-exec/health \
  -H "Authorization: Bearer YOUR_TOKEN"
```

---

### ✅ 2. `GET /api/py-exec/list`
**Purpose:** List all available diagnostic functions with descriptions

**Expected Response:**
```json
{
  "functions": [
    {
      "name": "get_sheet_vs_db_counts",
      "description": "Compare row counts: Google Sheets transactions vs MySQL."
    },
    ...
  ]
}
```

---

### ✅ 3. `POST /api/py-exec/run/get_sheet_vs_db_counts`
**Purpose:** Compare row counts between Google Sheets and MySQL `transactions` table

**Expected Response:**
```json
{
  "status": "ok",
  "db_total_rows": 1250,
  "db_active_rows": 1200,
  "deleted_rows": 50,
  "last_fetch_log": {
    "id": 42,
    "action": "sheet_fetch",
    "raw_row_count": 1200,
    ...
  },
  "note": "To get Google Sheets count, check the last sync log entry for 'raw_row_count'",
  "debug": {
    "connection_info": {"host": "...", "user": "...", "database": "..."},
    "connection_status": "closed",
    "queries_executed": [
      "✓ SELECT COUNT(*) as cnt FROM transactions → 1250",
      "✓ SELECT COUNT(*) as cnt FROM transactions WHERE deleted_at IS NULL → 1200",
      "✓ Fetched last_fetch log entry"
    ]
  },
  "executed_at": "2026-03-31T16:05:00.123456",
  "execution_time_ms": 45.23,
  "function": "get_sheet_vs_db_counts"
}
```

**Test Command:**
```bash
curl -X POST http://localhost:5000/api/py-exec/run/get_sheet_vs_db_counts \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{}'
```

---

### ✅ 4. `POST /api/py-exec/run/get_sync_status`
**Purpose:** Get last 5 sync operations from `sync_log` table

**Expected Response:**
```json
{
  "status": "ok",
  "recent_syncs": [
    {
      "id": 42,
      "action": "sheet_fetch",
      "status": "completed",
      "inserted": 5,
      "updated": 10,
      "errors": 0,
      "raw_row_count": 1200,
      "started_at": "2026-03-31T15:00:00",
      "completed_at": "2026-03-31T15:05:00",
      "error_message": null
    },
    ...
  ],
  "count": 5,
  "debug": {
    "query_executed": "SELECT from sync_log (last 5 entries)",
    "row_count": 5,
    "connection_status": "closed"
  },
  "executed_at": "2026-03-31T16:05:00.123456",
  "execution_time_ms": 23.45,
  "function": "get_sync_status"
}
```

**Test Command:**
```bash
curl -X POST http://localhost:5000/api/py-exec/run/get_sync_status \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{}'
```

---

### ✅ 5. `POST /api/py-exec/run/check_transaction_dups`
**Purpose:** Find duplicate transactions (same bib_id + date combination)

**Expected Response:**
```json
{
  "status": "ok",
  "duplicate_groups": [
    {
      "bib_id": 12345,
      "transaction_date": "2026-03-15",
      "count": 3,
      "ids": "101,102,103"
    },
    ...
  ],
  "count": 2,
  "note": "Each row shows a group of duplicates by bib_id + date",
  "debug": {
    "duplicate_groups_found": 2,
    "total_affected_transactions": 7,
    "connection_status": "closed"
  },
  "executed_at": "2026-03-31T16:05:00.123456",
  "execution_time_ms": 34.12,
  "function": "check_transaction_dups"
}
```

**Test Command:**
```bash
curl -X POST http://localhost:5000/api/py-exec/run/check_transaction_dups \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{}'
```

---

### ✅ 6. `POST /api/py-exec/run/check_transaction_nulls`
**Purpose:** Find transactions with NULL values in critical fields

**Expected Response:**
```json
{
  "status": "ok",
  "null_issues": [
    {"issue": "NULL bib_id", "count": 3},
    {"issue": "NULL transaction_date", "count": 0},
    {"issue": "NULL amount", "count": 2}
  ],
  "total_issues": 5,
  "debug": {
    "union_queries": 3,
    "null_fields_checked": ["bib_id", "transaction_date", "amount"],
    "issues_found": 3,
    "issue_breakdown": {
      "NULL bib_id": 3,
      "NULL transaction_date": 0,
      "NULL amount": 2
    },
    "connection_status": "closed"
  },
  "executed_at": "2026-03-31T16:05:00.123456",
  "execution_time_ms": 28.56,
  "function": "check_transaction_nulls"
}
```

**Test Command:**
```bash
curl -X POST http://localhost:5000/api/py-exec/run/check_transaction_nulls \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{}'
```

---

### ✅ 7. `POST /api/py-exec/run/get_sample_transactions`
**Purpose:** Fetch sample transaction rows for manual inspection

**Request (with optional limit parameter):**
```json
{
  "kwargs": {
    "limit": 10
  }
}
```

**Expected Response:**
```json
{
  "status": "ok",
  "samples": [
    {
      "id": 1001,
      "bib_id": 12345,
      "transaction_date": "2026-03-15",
      "amount": 25.00,
      "notes": "Event registration",
      "created_at": "2026-03-15T10:30:00",
      "updated_at": "2026-03-15T10:30:00"
    },
    ...
  ],
  "count": 10,
  "debug": {
    "limit_requested": 10,
    "fields_selected": 7,
    "rows_returned": 10,
    "sample_ids": [1001, 1002, 1003, ...],
    "connection_status": "closed"
  },
  "executed_at": "2026-03-31T16:05:00.123456",
  "execution_time_ms": 15.67,
  "function": "get_sample_transactions"
}
```

**Test Command:**
```bash
curl -X POST http://localhost:5000/api/py-exec/run/get_sample_transactions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{"kwargs": {"limit": 10}}'
```

---

### ✅ 8. `POST /api/py-exec/run/test_db_connection`
**Purpose:** Test DB connectivity and list all tables with column counts

**Expected Response:**
```json
{
  "status": "ok",
  "connected": true,
  "database": "mmrdb",
  "tables": [
    {"table_name": "transactions", "col_count": 12},
    {"table_name": "members", "col_count": 15},
    {"table_name": "sync_log", "col_count": 10},
    ...
  ],
  "timestamp": "2026-03-31T16:05:00.123456",
  "debug": {
    "config": {"host": "mmr-mysql-v4.mysql.database.azure.com", "user": "mmradmin", "database": "mmrdb"},
    "connection_status": "closed",
    "queries": [
      "✓ SELECT DATABASE() as db_name",
      "✓ Listed 8 tables with column counts"
    ],
    "table_count": 8,
    "table_names": ["transactions", "members", "sync_log", ...]
  }
}
```

**Test Command:**
```bash
curl -X POST http://localhost:5000/api/py-exec/run/test_db_connection \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{}'
```

---

### ✅ 9. `POST /api/py-exec/run/check_azure_email_config`
**Purpose:** Check Azure Communication Services email configuration

**Expected Response (Success):**
```json
{
  "status": "ok",
  "connection_string_present": true,
  "extracted_resource": "mmr-comm.unitedstates.communication.azure.com",
  "client_initialized": true,
  "message": "Azure Communication Services client initialized successfully. However, to send emails you need a verified sender domain in your Azure resource.",
  "next_steps": [
    "1. Go to Azure Portal → Communication Services → mmr-comm (or your resource)",
    "2. Navigate to 'Email' → 'Sender Domains'",
    ...
  ],
  "timestamp": "2026-03-31T16:05:00.123456"
}
```

**Test Command:**
```bash
curl -X POST http://localhost:5000/api/py-exec/run/check_azure_email_config \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{}'
```

---

### ✅ 10. `POST /api/py-exec/run/send_test_email`
**Purpose:** Send a test email to admin@mmrunners.org to verify email pipeline

**Expected Response (Success):**
```json
{
  "status": "ok",
  "azure_resource": "mmr-comm.unitedstates",
  "from_address": "DoNotReply@6e248907-c5ac-4a28-8297-f9834526aecd.us1.azurecomm.net",
  "sent_to": "admin@mmrunners.org",
  "subject": "🧪 MMR Admin Portal Test Email",
  "message": "Email sent successfully",
  "timestamp": "2026-03-31T16:05:00.123456",
  "debug": {
    "connection_string_endpoint": "endpoint=https://mmr-comm.unitedstates.communication.azure.com/;...",
    "note": "If azure_resource doesn't match your mmr-comm resource, update the env var"
  },
  "executed_at": "2026-03-31T16:05:00.123456",
  "execution_time_ms": 567.89,
  "function": "send_test_email"
}
```

**Test Command:**
```bash
curl -X POST http://localhost:5000/api/py-exec/run/send_test_email \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{}'
```

---

### ✅ 11. `POST /api/py-exec/code`
**Purpose:** Execute arbitrary Python code with access to DB helpers (`query`, `execute`)

**Request:**
```json
{
  "code": "result = query('SELECT COUNT(*) as cnt FROM transactions')\nprint(f'Total rows: {result[0][\"cnt\"]}')"
}
```

**Expected Response:**
```json
{
  "status": "ok",
  "output": "Total rows: 1250\n",
  "executed_at": "2026-03-31T16:05:00.123456",
  "execution_time_ms": 45.23,
  "debug": {
    "code_length": 95,
    "code_lines": 2,
    "available_helpers": ["query", "execute", "datetime", "json", "traceback"]
  }
}
```

**Test Command:**
```bash
curl -X POST http://localhost:5000/api/py-exec/code \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{
    "code": "result = query(\"SELECT COUNT(*) as cnt FROM transactions\")\nprint(f\"Total rows: {result[0][\\\"cnt\\\"]}\")"
  }'
```

---

## Console Logging

All function executions now log to stdout with `[PY_EXEC]` prefix:

```
[PY_EXEC] Executing: get_sheet_vs_db_counts
[PY_EXEC] ✓ get_sheet_vs_db_counts completed in 45ms (status: ok)

[PY_EXEC] ✗ check_transaction_dups failed in 123ms: MySQLError: Access denied
```

Code executions log with `[CODE_EXEC]` prefix:

```
[CODE_EXEC] Executing 2 lines of code (95 chars)
[CODE_EXEC] ✓ Execution completed successfully in 23ms
```

---

## Bug Fixes Applied

### Critical Issue: `get_db_connection()` doesn't exist
**Fixed in:** All 6 database functions + health check
**Change:** `dbmod.get_db_connection()` → `dbmod.get_conn()`
**Files affected:**
- `get_sheet_vs_db_counts()`
- `get_sync_status()`
- `check_transaction_dups()`
- `check_transaction_nulls()`
- `get_sample_transactions()`
- `test_db_connection()`
- `health_check()`

**Why:** The `db.py` module only exports `get_conn()`. The wrong function name was causing `AttributeError` on execution.

---

## Testing Strategy

1. **Start with health check** → Verifies DB connection works
2. **Test read-only functions** → `get_sheet_vs_db_counts`, `get_sync_status`, etc. (safe, no side effects)
3. **Test arbitrary code** → `/api/py-exec/code` with simple SELECT queries
4. **Test email functions** → Only after confirming Azure credentials are set
5. **Check logs** → Azure App Service logs should show `[PY_EXEC]` entries

---

## Common Errors & Solutions

| Error | Cause | Fix |
|-------|-------|-----|
| `AttributeError: module 'db' has no attribute 'get_db_connection'` | Using old function name | ✅ Already fixed in this version |
| `MySQLError: Access denied for user ...` | DB credentials invalid | Check `db_config` in debug output; verify Keychain entry |
| `Connection timeout` | Azure DB unreachable | Check network; verify firewall rules on Azure |
| `No such table` | Wrong schema version | Compare against `db/schemas/snapshot.sql` |
| `SyntaxError` in code execution | Malformed Python | Check code for syntax errors; traceback will show line |

---

## Next Steps

- Run all 11 endpoints/functions through a test suite
- Monitor Azure App Service logs for `[PY_EXEC]` entries
- If any function fails, check the `debug` object for detailed context
- Verify all database operations are working before deploying to production

---

**Questions?** Check the `debug` object in each response — it contains the full execution trace.


# --- Merged from PYTHON_EXEC_QUICK_START.md ---

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


# --- Merged from mmr-admin/PYTHON_CODE_EDITOR_README.md ---

# Python Code Editor — Admin Portal

## Overview

The **Python Code Editor** is a dynamic code execution environment in the MMR Admin Portal. Write and run Python code directly against your database with live output capture.

**Access:** Admin Portal → "Python Code" tab (admin/super_admin only)

## Features

✅ **Write & Run** — Type Python code and execute instantly
✅ **Database Access** — Query and modify MySQL data directly
✅ **Output Capture** — All `print()` output captured and displayed
✅ **Error Handling** — Full traceback on exceptions
✅ **Examples** — Quick-insert templates for common tasks
✅ **Download Results** — Export code + output as .txt file

## Available Functions

### `query(sql)` — Read Data
Execute SELECT queries and get results as list of dicts.

```python
results = query("SELECT * FROM webapp_events LIMIT 5")
for row in results:
    print(f"{row['EventID']}: {row['EventName']}")
```

**Returns:** List of dictionaries (one per row)

### `execute(sql, params)` — Write Data
Execute INSERT, UPDATE, or DELETE queries.

```python
execute("UPDATE transactions SET status = %s WHERE id = %s", ['processed', 123])
```

**Returns:** Affected row count

### Standard Modules
- `datetime` — Date/time operations
- `json` — JSON parsing/serialization
- `traceback` — Error handling

## Usage Examples

### Example 1: Count Events by Status
```python
results = query("""
  SELECT Status, COUNT(*) as cnt
  FROM webapp_events
  GROUP BY Status
  ORDER BY cnt DESC
""")

for row in results:
    print(f"{row['Status']}: {row['cnt']} events")
```

### Example 2: Find Data Issues
```python
# Find NULL values
results = query("""
  SELECT
    'NULL bib_id' as issue, COUNT(*) as cnt
  FROM transactions WHERE bib_id IS NULL
  UNION ALL
  SELECT 'NULL amount' as issue, COUNT(*) as cnt
  FROM transactions WHERE amount IS NULL
""")

for row in results:
    if row['cnt'] > 0:
        print(f"⚠️  {row['issue']}: {row['cnt']}")
```

### Example 3: Pretty Print JSON
```python
import json

results = query("SELECT * FROM webapp_events WHERE EventID = %s LIMIT 1", ['EV-123'])
if results:
    print(json.dumps(results[0], indent=2, default=str))
```

### Example 4: Batch Update with Timestamps
```python
from datetime import datetime

now = datetime.utcnow().isoformat()
execute(
    "UPDATE transactions SET ProcessedTime = %s WHERE ProcessedTime IS NULL",
    [now]
)
print(f"Updated rows at {now}")
```

### Example 5: Generate Reports
```python
results = query("""
  SELECT
    MemberID, MemberName, COUNT(*) as txn_count,
    SUM(amount) as total_amount
  FROM transactions
  WHERE deleted_at IS NULL
  GROUP BY MemberID
  ORDER BY total_amount DESC
  LIMIT 10
""")

print("Top 10 Members by Transaction Amount:")
print("-" * 60)
for row in results:
    print(f"{row['MemberName']:30} | {row['txn_count']:3} txns | ${row['total_amount']:8.2f}")
```

## Built-in Examples

The sidebar has quick-insert examples:

1. **Count Events** — Basic query with aggregation
2. **Recent Syncs** — List last 10 sync operations
3. **Transaction Dups** — Find duplicate transactions
4. **NULL Checks** — Find incomplete data
5. **Pretty Print** — Format JSON output

Click any example to insert it into the editor.

## Tips & Best Practices

**Debugging Workflow:**
1. Write a simple query first (e.g., COUNT)
2. Add LIMIT to large result sets
3. Use `json.dumps()` to inspect row structure
4. Add print statements to trace execution

**Performance:**
- Always use LIMIT for exploratory queries
- Filter in SQL (WHERE) not in Python
- Large result sets (>10k rows) will be slow
- Consider batching with `LIMIT ... OFFSET`

**Security:**
- Parameterized queries: `query(sql, [params])` ✅
- String interpolation: `f"... {variable} ..."` ⚠️ (risky)
- Never paste untrusted SQL directly

**Common Patterns:**

Count distinct values:
```python
results = query("SELECT COUNT(DISTINCT MemberID) as unique_members FROM transactions")
print(results[0]['unique_members'])
```

Check for recent changes:
```python
results = query("""
  SELECT * FROM transactions
  WHERE updated_at > DATE_SUB(NOW(), INTERVAL 1 HOUR)
  ORDER BY updated_at DESC
""")
print(f"Updated in last hour: {len(results)}")
```

Export as CSV:
```python
import csv
results = query("SELECT * FROM webapp_events LIMIT 100")

print("EventID,EventName,EventStartDate,EventEndDate")
for row in results:
    print(f"{row['EventID']},{row['EventName']},{row['EventStartDate']},{row['EventEndDate']}")
```

## Error Messages

**"No code provided"** → Empty editor. Write some code.

**"ModuleNotFoundError: No module named 'X'"** → Module not in available imports. Only `datetime`, `json`, `traceback` are pre-imported.

**"NameError: name 'X' is not defined"** → Variable doesn't exist. Check spelling.

**"Database error: ..."** → SQL syntax error or connection issue. Check the SQL query.

## Limitations

- ⏱️ **Timeout:** Long-running queries may timeout (30s limit in Azure)
- 📊 **Large Results:** >10k rows will be slow to fetch
- 🔒 **No File I/O:** Cannot read/write local files
- 🚫 **No External Libraries:** Only `datetime`, `json`, `traceback`
- 🔐 **Execution Environment:** Sandboxed but has full DB access

## Related

- `PYTHON_EXEC_README.md` — Pre-built diagnostic functions
- `DATA_QUERY_README.md` — SQL query interface (similar but SQL-only)

## Troubleshooting

**Code runs but no output?**
- Add `print()` statements
- Check the "Output:" section below the editor
- If empty, code ran successfully but printed nothing

**Query returns empty list?**
- Add `LIMIT 1` to verify table exists
- Check table name spelling (case-sensitive)
- Try `query("SHOW TABLES")` to list all tables

**Want to download results?**
- Click "📥 Download" button below results
- Saves code + output as .txt file with timestamp

**Performance is slow?**
- Remove `LIMIT` constraint and try smaller dataset
- Check for missing database indexes
- Large joins may timeout — break into multiple queries


# --- Merged from mmr-admin/PYTHON_EXEC_README.md ---

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


# --- Merged from mmr-admin/DATA_QUERY_README.md ---

# Data Query Tab — MMR Admin Portal

## Overview

A new **Data Query** tab in the mmr-admin Flask app that lets you run SQL queries directly against MySQL without needing port 3306 access from your machine.

## Files Added

1. **`api_query.py`** — Flask blueprint with two routes:
   - `GET /query` — Renders the query editor UI
   - `POST /api/query/execute` — Executes the SQL and returns results

2. **`templates/query.html`** — Interactive UI with:
   - SQL text input area
   - Run / Clear / Examples buttons
   - Quick reference sidebar (common queries, config keys)
   - Dual result display: **Table view** + **JSON view**
   - Copy-to-clipboard for JSON output

3. **Updated `app.py`** — Registered the `query_bp` blueprint

4. **Updated `templates/index.html`** — Added "Data Query" tab link to the nav

## Access Control

- **Super-admins** (`admin@mmrunners.org`, `cathy.lin@mmrunners.org`): Full SQL access (SELECT, INSERT, UPDATE, DELETE)
- **Regular admins**: SELECT-only (read-only, safe)

Edit the `_is_super_admin()` function in `api_query.py` to modify the whitelist.

## How to Use

1. Navigate to the mmr-admin portal
2. Click the **Data Query** tab (appears for admins only)
3. Paste or type your SQL query in the text area
4. Click **Run Query**
5. View results in **Table** or **JSON** format
6. Copy JSON to clipboard if needed

## Quick Reference Queries

Sidebar includes quick buttons for:
- `SELECT ConfigKey, ConfigValue FROM config;`
- `SELECT ConfigValue FROM config WHERE ConfigKey = 'SheetsWebhookUrl';`
- `SELECT COUNT(*) as cnt FROM members;`
- `SELECT COUNT(*) as cnt FROM payments;`
- `SELECT Status, COUNT(*) FROM members GROUP BY Status;`
- `SELECT * FROM payments ORDER BY PaymentDate DESC LIMIT 10;`

## Example Workflows

### Check SheetsWebhookUrl
1. Click the sidebar button: "SheetsWebhookUrl"
2. Click **Run Query**
3. If the result is empty, the config value is missing → insert it in Azure Portal

### Insert Missing Config
```sql
INSERT INTO config (ConfigKey, ConfigValue)
VALUES ('SheetsWebhookUrl', 'https://script.google.com/macros/s/YOUR_DEPLOYMENT_ID/exec')
ON DUPLICATE KEY UPDATE ConfigValue = VALUES(ConfigValue);
```

### Member Stats
```sql
SELECT Status, Type, COUNT(*) as cnt
FROM members
GROUP BY Status, Type
ORDER BY Status, Type;
```

### Recent Payments with Member Info
```sql
SELECT p.PaymentID, p.PaymentDate, p.Amount, p.PaymentIntent,
       m.FirstName, m.LastName, m.Email
FROM payments p
LEFT JOIN members m ON p.MemberID = m.MemberID
ORDER BY p.PaymentDate DESC
LIMIT 20;
```

## Error Handling

- **403 Forbidden** — You don't have permission to run non-SELECT queries (regular admin)
- **400 Bad Request** — SQL syntax error or connection issue (see error message)
- **Status display** — Green checkmark + row count on success

## Notes

- Queries run **synchronously** (up to 15-second timeout)
- Results limited to first **10,000 rows** by default (avoid `SELECT *` on large tables)
- No transaction support (auto-commit mode)
- Read-only mode for regular admins prevents accidental data loss
