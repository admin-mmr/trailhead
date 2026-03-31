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
