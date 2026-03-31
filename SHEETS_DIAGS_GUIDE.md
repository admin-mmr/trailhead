# Google Sheets Diagnostic Functions

New execution points added to read, update, and compare Google Sheets data for members, payments, and webapp_events.

## New Diagnostic Functions

### 1. `compare_sheets_vs_db()` — SYNC COMPARISON
Compares Google Sheets data against MySQL database for all major tables.

**Compares:**
- Members sheet vs `members` table
- Payments sheet vs `payments` table
- WebApp Events sheet vs `webapp_events` table

**Returns:** Row counts for each, sync status (✓ synced / ⚠ out of sync), overall recommendation

**Use case:** Quick sync health check to spot discrepancies between Sheets and database

---

### 2. `get_sheets_members(limit=50)` — READ MEMBERS
Fetches recent member records from Google Sheets via GAS webhook.

**Webhook action:** `get_members`

**Returns:**
- List of member dicts (up to limit)
- Total count in Google Sheets
- Sample column names

**Sample columns:** MemberID, FirstName, LastName, Email, Phone, MembershipStatus, MembershipExpiry, JoinDate

**Use case:** Verify member data is present in Sheets, spot missing/stale records

---

### 3. `get_sheets_payments(limit=50)` — READ PAYMENTS
Fetches recent payment records from Google Sheets via GAS webhook.

**Webhook action:** `get_payments`

**Returns:**
- List of payment dicts (up to limit)
- Total count in Google Sheets
- Sample column names

**Sample columns:** PaymentID, MemberID, Amount, PaymentDate, PaymentMethod, PayerName, TransactionReference

**Use case:** Verify payment data is synced to Sheets, check for missing transactions

---

### 4. `get_sheets_events(limit=50)` — READ EVENTS
Fetches recent webapp_event records from Google Sheets via GAS webhook.

**Webhook action:** `get_events`

**Returns:**
- List of event dicts (up to limit)
- Total count in Google Sheets
- Sample column names

**Sample columns:** EventID, EventName, EventDate, Location, MemberID, BibNumber, RegistrationDate

**Use case:** Verify event registrations are logged in Sheets, spot missed syncs

---

### 5. `get_sheets_transactions(limit=50)` — READ TRANSACTIONS
Fetches recent transaction records from Google Sheets (email import source).

**Webhook action:** `get_transactions`

**Returns:**
- List of transaction dicts (up to limit)
- Total count in Google Sheets
- Sample column names

**Sample columns:** MessageId, TimeStamp, Sender, Amount, TransactionNumber, Subject

**Use case:** Verify transactions from email imports are in Sheets before DB processing

---

### 6. `update_sheets_members(rows)` — UPDATE MEMBERS
Updates member records in Google Sheets.

**Parameters:**
- `rows`: List of member dicts (each must have `MemberID` + fields to update)

**Webhook action:** `update_members`

**Returns:** Count of rows sent and updated

**Example:**
```python
rows_to_update = [
    {
        'MemberID': '123',
        'MembershipStatus': 'Active',
        'LastUpdated': '2026-03-31'
    }
]
result = update_sheets_members(rows_to_update)
# Returns: {status: 'ok', rows_sent: 1, rows_updated: 1}
```

---

### 7. `update_sheets_payments(rows)` — UPDATE PAYMENTS
Updates payment records in Google Sheets.

**Parameters:**
- `rows`: List of payment dicts (each must have `PaymentID` + fields to update)

**Webhook action:** `update_payments`

**Returns:** Count of rows sent and updated

---

### 8. `update_sheets_events(rows)` — UPDATE EVENTS
Updates event records in Google Sheets.

**Parameters:**
- `rows`: List of event dicts (each must have `EventID` + fields to update)

**Webhook action:** `update_events`

**Returns:** Count of rows sent and updated

---

## Data Flow: GAS Webhook Integration

```
Python Function (api_sheets_diags.py)
        ↓
_call_gas_webhook(payload: {action, ...})
        ↓
Fetch SheetsWebhookUrl from MySQL Config table
        ↓
POST to GAS webhook with action + optional rows
        ↓
GAS receives POST → routes to handler
  - get_members → reads Members sheet → returns array
  - get_payments → reads Payments sheet → returns array
  - get_events → reads WebApp Events sheet → returns array
  - get_transactions → reads Transactions sheet → returns array
  - update_members → writes rows → returns {updated: N}
  - update_payments → writes rows → returns {updated: N}
  - update_events → writes rows → returns {updated: N}
        ↓
GAS returns: {ok: true, data: {...}}
        ↓
Python function parses response
        ↓
Returns rich debug result with row counts, sample columns, etc.
```

---

## Testing the Functions

### List all available diagnostic functions
```bash
curl -X GET http://localhost:5000/api/py-exec/list \
  -H "Authorization: Bearer <token>"
```

### Get recent members from Sheets
```bash
curl -X GET http://localhost:5000/api/py-exec/run/get_sheets_members \
  -H "Authorization: Bearer <token>"
```
**Expected:** List of members, row count, sample columns

### Compare Sheets vs DB
```bash
curl -X GET http://localhost:5000/api/py-exec/run/compare_sheets_vs_db \
  -H "Authorization: Bearer <token>"
```
**Expected:** Comparison table showing sync status for members/payments/events

### Execute custom Python with Sheets functions
```bash
curl -X POST http://localhost:5000/api/py-exec/execute \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "code": "
from api_sheets_diags import get_sheets_members, compare_sheets_vs_db
members = get_sheets_members(limit=5)
sync = compare_sheets_vs_db()
print(f'Members: {members[\"row_count\"]}')
print(f'Sync status: {sync[\"summary\"][\"overall_status\"]}')
"
  }'
```

---

## Error Handling

### "SheetsWebhookUrl not configured"
**Cause:** Config table doesn't have the GAS webhook URL
**Fix:** Set the webhook URL in MySQL Config table:
```sql
INSERT INTO Config (ConfigKey, ConfigValue)
VALUES ('SheetsWebhookUrl', 'https://script.google.com/macros/d/...')
ON DUPLICATE KEY UPDATE ConfigValue = VALUES(ConfigValue);
```

### HTTP errors or GAS errors in response
**Cause:** Webhook request failed or GAS handler crashed
**Solution:** Check Azure Application Logs for `[webhook_client]` entries, and check GAS execution logs

### Empty data returned
**Cause:** Google Sheets might be empty or GAS returned empty array
**Fix:** Check the GAS spreadsheet directly to verify data exists

---

## Module Architecture

| Module | Size | Purpose |
|--------|------|---------|
| `api_python_exec.py` | 681 lines | Core execution engine + diagnostic orchestration |
| `api_email_diags.py` | 230 lines | Email pipeline diagnostics (webhook, Gmail, activity logs) |
| `api_sheets_diags.py` | 436 lines | Google Sheets read/write diagnostics |

All modules follow the same pattern:
- Leaf modules: No inter-module imports (only db + stdlib)
- Orchestrator: api_python_exec.py imports from both leaf modules
- Rich debug output: All functions return status, row counts, sample data, timestamps

---

## Related Files

- `mmr-admin/api_python_exec.py` — Execution engine that registers and runs diagnostic functions
- `mmr-admin/api_sheets_diags.py` — Google Sheets diagnostics module
- `mmr-admin/api_email_diags.py` — Email pipeline diagnostics module
- `mmr-admin/api_sheets_sync.py` — Main sync logic (uses GAS webhook)
- GAS repository: `sheets_api_handlers.gs` — GAS handlers for read/write operations

---

**Last updated:** 2026-03-31
**Author:** Claude (Cowork)
