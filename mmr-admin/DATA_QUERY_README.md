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
