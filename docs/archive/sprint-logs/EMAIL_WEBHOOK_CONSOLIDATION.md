# Email Webhook Consolidation — Azure → GAS

**Status: Complete**
**Date: 2026-03-31**

## Overview

Consolidated all email sending in mmr-admin from Azure Communication Services to a webhook-based approach using Google Apps Script (GAS) and Gmail. All emails now:

1. **Send via GAS webhook** — POST from mmr-admin → GAS webhook endpoint
2. **Delivered by Gmail** — GAS uses Google's GmailApp to send
3. **Logged automatically** — Every email logged to Google Sheets (Email Log sheet)

## Architecture

```
mmr-admin (Python)
  ↓ (webhook POST)
GAS webhook (email_send action)
  ↓ (sends via Gmail)
recipient@example.com
  ↓ (logs to Sheets)
Email Log sheet (audit trail)
```

## Changes Made

### 1. GAS Changes

**New file: `web-apps/gas/membership/src/email_hook.ts`**
- Receives `email_send` action POSTs from mmr-admin
- Validates payload (to, subject, html_content required)
- Sends via `GmailApp.sendEmail()`
- Logs to Email Log sheet with:
  - EmailID, Timestamp, RecipientEmail, CCEmail
  - Subject, EmailType, MemberID, Status
  - ErrorMessage, HTMLLength, DeliveredAt, Notes

**Updated: `web-apps/gas/membership/src/webhook.ts`**
- Added `case 'email_send'` → `handleEmailSend()`
- Calls new email_hook.ts functions

**Updated: `web-apps/gas/membership/src/config.ts`**
- Added EMAIL_LOG_SHEET_ID and EMAIL_LOG_SHEET_NAME constants
- Created CONFIG object for cross-module access
- Exported all constants to globalThis

### 2. mmr-admin Changes

**New file: `mmr-admin/webhook_client.py`**
- Replaces `email_client.py` (Azure SDK removed)
- Functions:
  - `send_email_webhook()` — core function, POSTs to GAS
  - `send_payment_approved_email()`
  - `send_payment_rejected_email()`
  - `send_membership_activated_email()`
  - `send_admin_notification_email()`
  - `send_generic_email()` — for api_sheets_sync
- Gets webhook URL from MySQL Config table or env var

**Updated: `mmr-admin/payment_actions.py`**
- Changed import from `email_client` → `webhook_client`
- All email functions automatically use webhook

**Updated: `mmr-admin/api_sheets_sync.py`**
- Changed import from `send_email` → `send_generic_email`
- Updated call signature (now returns bool, simpler interface)

**Updated: `mmr-admin/api_python_exec.py`**
- Replaced `check_azure_email_config()` → `check_webhook_email_config()`
- Updated `send_test_email()` to use `send_email_webhook()`
- Removed all Azure-specific logic
- Test email now shows webhook/Gmail sender

### 3. Configuration

**Webhook URL setup (pick one):**

Option A: MySQL Config table (preferred)
```sql
INSERT INTO Config (Key, Value) VALUES ('SheetsWebhookUrl', 'https://script.google.com/macros/d/..../usercoderun');
```

Option B: Environment variable
```bash
export SHEETS_WEBHOOK_URL='https://script.google.com/...'
```

**Email Log sheet:**
- Spreadsheet ID: `1G0dr2vjW-vMN0UbpxvzdBajmFSQLsiRbLd1A-36xk0I`
- Sheet name: `Current`
- Columns: EmailID, Timestamp, RecipientEmail, CCEmail, Subject, EmailType, MemberID, Status, ErrorMessage, HTMLLength, DeliveredAt, Notes

## Benefits

✅ **No more Azure SDK configuration** — removed dependency on Azure Communication Services
✅ **Built-in email logging** — automatic Sheets audit trail
✅ **Direct Gmail delivery** — uses Google's infrastructure
✅ **Simpler error handling** — webhook logs failures automatically
✅ **Email type tracking** — categorize emails (payment_approved, membership_activated, etc.)
✅ **Member metadata** — link emails to specific members in logs

## Testing

1. **Build GAS:**
   ```bash
   cd web-apps/gas/membership
   npm run build
   ```

2. **Deploy GAS:**
   - Go to Apps Script editor
   - Create new version
   - Deploy as web app

3. **Test imports:**
   ```bash
   cd mmr-admin
   python3 test_imports.py
   # ✅ webhook_client (passes)
   ```

4. **Test email:**
   - Use `api_python_exec.py` endpoint: `/run/send_test_email`
   - Check Email Log sheet for entry
   - Check admin@mmrunners.org inbox

## Migration Checklist

- [x] Create email_hook.ts in GAS
- [x] Update webhook.ts to route email_send action
- [x] Add EMAIL_LOG_SHEET constants to config.ts
- [x] Create webhook_client.py in mmr-admin
- [x] Update payment_actions.py imports
- [x] Update api_sheets_sync.py imports
- [x] Update api_python_exec.py functions
- [x] GAS build succeeds (npm run build ✅)
- [x] Python imports pass (test_imports.py ✅)
- [ ] Deploy GAS webhook
- [ ] Set SHEETS_WEBHOOK_URL in config or env
- [ ] Test send_test_email endpoint
- [ ] Verify Email Log sheet receives entries
- [ ] Test payment_approved flow

## Files Modified

**GAS:**
- `web-apps/gas/membership/src/email_hook.ts` — NEW
- `web-apps/gas/membership/src/webhook.ts` — modified
- `web-apps/gas/membership/src/config.ts` — modified

**Python:**
- `mmr-admin/webhook_client.py` — NEW
- `mmr-admin/payment_actions.py` — modified (import)
- `mmr-admin/api_sheets_sync.py` — modified (import + usage)
- `mmr-admin/api_python_exec.py` — modified (function names, logic)

**Deprecated (no longer used):**
- `mmr-admin/email_client.py` — can be removed after testing

## Next Steps

1. Deploy GAS webhook (Apps Script → New Version → Deploy)
2. Configure webhook URL (MySQL or env)
3. Run test_email endpoint to verify
4. Monitor Email Log sheet for entries
5. Once verified, remove email_client.py
