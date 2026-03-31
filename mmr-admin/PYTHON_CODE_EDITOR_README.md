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
