# GAS Email Pipeline Diagnostics

New execution points added to trace email flow from webhook POST through GAS to Gmail and database logging.

## New Diagnostic Functions

### 1. `analyze_email_flow()` — COMPREHENSIVE OVERVIEW
Runs 4-point health check on the entire email pipeline:
- ✓ GAS webhook URL configured in MySQL Config table
- ✓ gmail_transactions table has received email records
- ✓ activity_log contains email-related actions
- ✓ Config table has email/webhook settings

**Returns:** Pipeline status summary + component checks
**Use case:** Quick health check before investigating specific failures

---

### 2. `get_gas_webhook_config()`
Verifies that the GAS webhook URL is stored in MySQL `Config` table.

**Query:**
```sql
SELECT ConfigKey, ConfigValue FROM Config WHERE ConfigKey = 'SheetsWebhookUrl'
```

**Returns:**
- `configured`: bool — is webhook URL set?
- `webhook_url_preview`: str — first 80 chars of URL

**Note:** The webhook URL must be set for any email sends to work. If missing, all emails to GAS will fail with "SHEETS_WEBHOOK_URL not found" error.

---

### 3. `get_gmail_transactions_recent(limit=20)`
Queries the `gmail_transactions` table for recent records.

**What this table contains:**
- `MessageId`: Gmail message ID (primary key)
- `TimeStamp`: When email arrived
- `Sender`: Who sent it (e.g., noreply@example.com)
- `Subject`: Email subject line
- `Amount`: Dollar amount (if payment email)
- `TransactionNumber`: Bib number / transaction ID
- `Source`: Where it came from (e.g., 'gmail', 'import')
- `WebAppID`: Associated web app ID
- `IsArchived`: Soft delete flag
- `SyncedAt`: When the record was last updated

**Important:** This table logs **RECEIVED** emails from Gmail (e.g., payment confirmations, registrations). NOT emails we send out via GAS webhook.

**Returns:** 20 most recent non-archived email records

---

### 4. `get_email_send_status()`
Checks two places for email send logging:

#### A. `activity_log` table
Searches for records where `Action` contains 'email' or 'webhook':
```sql
SELECT LogID, MemberID, Email, Action, Timestamp, Details
FROM activity_log
WHERE Action LIKE '%email%' OR Action LIKE '%webhook%'
ORDER BY Timestamp DESC LIMIT 50
```

#### B. `Config` table
Searches for email/webhook related config entries:
```sql
SELECT ConfigKey, ConfigValue FROM Config
WHERE ConfigKey LIKE '%email%' OR ConfigKey LIKE '%webhook%'
```

**Returns:** activity_log records + email config entries

**Note:** GAS webhook responses (POST success/failure, response body) are logged to **Azure Application Logs**, not the database. To see webhook response details:
1. Go to Azure Portal → mmr-admin function → Monitor → Logs
2. Search for `[webhook_client]` logs
3. Or check GAS execution logs: Google Apps Script → Editor → Executions

---

## Email Flow Diagram

```
Send Email Request (webhook_client.py)
        ↓
Load GAS webhook URL from Config table
        ↓
POST payload to GAS webhook
(action='email_send', to, subject, html_content, etc.)
        ↓
GAS receives POST → email_hook.ts handler
        ↓
GAS builds Gmail draft → sends via Gmail API
        ↓
GAS logs to Email Log sheet (spreadsheet row)
        ↓
GAS returns response: { ok: true, email_id: '...', status: 'sent' }
        ↓
webhook_client.py parses response
        ↓
Returns dict: { success, status, email_id, message, error }
        ↓
Calling function (payment_actions.py, api_sheets_sync.py, etc.)
  receives result dict and handles success/failure
        ↓
Optional: Log to activity_log or other table (application-dependent)
```

---

## Logging Locations

| Component | Logs To | What's Logged |
|-----------|---------|---------------|
| **webhook_client.py** | Azure App Logs | POST request, response status, JSON parse, errors (tagged: `[webhook_client]`) |
| **GAS email_hook.ts** | GAS Execution Logs | Gmail draft creation, send status, Email Log sheet append |
| **Gmail** | Gmail inbox | Sent email appears in Gmail sent folder |
| **Database (Gmail received)** | `gmail_transactions` | Received emails from Gmail inbox (sync'd periodically) |
| **Database (Send logging)** | `activity_log` (optional) | Logged by calling function after webhook response received |

---

## Testing the Pipeline

### Step 1: Verify Webhook Config
```bash
curl -X GET http://localhost:5000/api/py-exec/run/get_gas_webhook_config \
  -H "Authorization: Bearer <token>"
```
**Expected:** `configured: true`, URL preview showing `https://script.google.com/...`

### Step 2: Check Recent Gmail Transactions
```bash
curl -X GET http://localhost:5000/api/py-exec/run/get_gmail_transactions_recent \
  -H "Authorization: Bearer <token>"
```
**Expected:** Recent email records from Gmail inbox

### Step 3: Full Pipeline Health
```bash
curl -X GET http://localhost:5000/api/py-exec/run/analyze_email_flow \
  -H "Authorization: Bearer <token>"
```
**Expected:** All 4 checks green (✓), pipeline_status = "HEALTHY"

### Step 4: Send Test Email
```bash
curl -X GET http://localhost:5000/api/py-exec/run/send_test_email \
  -H "Authorization: Bearer <token>"
```
**Expected:** Branded HTML email arrives in admin@mmrunners.org inbox within 30 seconds

---

## Common Issues & Troubleshooting

### Issue: "SHEETS_WEBHOOK_URL not found in MySQL config or environment"
**Cause:** GAS webhook URL not set in Config table
**Fix:** Run GAS setup to generate webhook URL, then insert:
```sql
INSERT INTO Config (ConfigKey, ConfigValue)
VALUES ('SheetsWebhookUrl', 'https://script.google.com/macros/d/...')
ON DUPLICATE KEY UPDATE ConfigValue = VALUES(ConfigValue);
```

### Issue: Webhook returns error but no details
**Solution:** Check Azure App Logs for `[webhook_client]` tagged entries
- Look for response body
- Check GAS execution logs for email_hook.ts handler errors

### Issue: Email sent successfully but not appearing in gmail_transactions
**Cause:** gmail_transactions logs RECEIVED emails, not sent emails
**Note:** The `send_test_email()` function sends via GAS/Gmail, but the receipt is logged elsewhere:
- GAS Email Log sheet (Google Sheet)
- Gmail sent folder
- `activity_log` if calling function logs it

---

## Related Files

- `mmr-admin/webhook_client.py` — Webhook client implementation
- `mmr-admin/api_python_exec.py` — Diagnostic functions (this file)
- `db/schemas/mmr_consolidated.sql` — gmail_transactions, Config, activity_log schema
- GAS repository: `email_hook.ts` — GAS webhook handler

---

**Last updated:** 2026-03-31
**Author:** Claude (Cowork)
