# GAS Email Webhook Setup

## Step 1: Deploy GAS Webhook

1. Open [Google Apps Script](https://script.google.com)
2. Create new project or open existing `mmr-membership` project
3. Go to **Project Settings** → ensure **Service account** is enabled
4. Go to **Editor** → **Manage deployments**
5. Edit existing deployment or create new
6. Select **New type: Web app**
7. Execute as: **Me** (your Google account)
8. Who has access: **Anyone** (or just you for testing)
9. Deploy → Copy the deployment URL

## Step 2: Configure Webhook URL

### Option A: MySQL Config Table (Recommended)
```sql
INSERT INTO Config (Key, Value) VALUES (
  'SheetsWebhookUrl',
  'https://script.google.com/macros/d/ABC123.../usercoderun'
);
```

Replace `ABC123...` with your actual deployment URL.

### Option B: Environment Variable
```bash
export SHEETS_WEBHOOK_URL='https://script.google.com/macros/d/ABC123.../usercoderun'
```

## Step 3: Verify Email Log Sheet

1. Open [Email Log sheet](https://docs.google.com/spreadsheets/d/1G0dr2vjW-vMN0UbpxvzdBajmFSQLsiRbLd1A-36xk0I)
2. Check that **Current** tab has headers:
   - EmailID, Timestamp, RecipientEmail, CCEmail, Subject, EmailType, MemberID, Status, ErrorMessage, HTMLLength, DeliveredAt, Notes
3. If headers missing, GAS webhook will initialize them on first email

## Step 4: Test Email Pipeline

Go to mmr-admin → Admin Portal → **Python Exec** tab

1. Select function: **send_test_email**
2. Click **Run**
3. Check result — should show `email_id` and timestamp
4. Check Email Log sheet — should have new entry with status: **sent**
5. Check admin@mmrunners.org inbox — should receive test email

## Step 5: Monitor Email Log

All emails now logged with:
- **EmailID** — unique per email (EM-timestamp-random)
- **Timestamp** — when sent (ISO format)
- **RecipientEmail** — who received it
- **Status** — sent or failed
- **ErrorMessage** — if failed, error reason
- **EmailType** — category (payment_approved, membership_activated, test, etc.)
- **MemberID** — linked member if applicable
- **Notes** — extra metadata as JSON

### Query examples in Python Exec:
```python
# Get all failed emails today
from datetime import datetime, timedelta
today = datetime.utcnow().date()
result = query('''
  SELECT EmailID, RecipientEmail, ErrorMessage, Timestamp
  FROM EmailLog
  WHERE Status = 'failed'
  AND DATE(Timestamp) = %s
''', (today,))
print(json.dumps(result, indent=2))
```

## Troubleshooting

### Webhook URL not found
- Check MySQL Config table: `SELECT Value FROM Config WHERE Key = 'SheetsWebhookUrl'`
- Or set env var: `export SHEETS_WEBHOOK_URL='...'`
- Redeploy GAS and copy new URL

### Email appears sent but not in Email Log
- Check GAS logs: Apps Script → Execution log
- Look for `[email_hook]` messages
- May be permissions issue — ensure GAS can write to Email Log sheet

### Email fails with error
- Check error in Email Log sheet → ErrorMessage column
- Common issues:
  - Invalid recipient email
  - GAS quota exceeded (limit: 100 emails/day in sandbox)
  - Sheet permissions (GAS needs write access to Email Log)

### Email not delivered to recipient
- Check Email Log status = sent (if sent, issue is on Gmail side)
- Check Gmail spam folder
- Verify recipient email is correct in payload

## API Reference

### Webhook POST

```bash
curl -X POST 'https://script.google.com/macros/d/.../usercoderun' \
  -H 'Content-Type: application/json' \
  -d '{
    "action": "email_send",
    "to": "user@example.com",
    "subject": "Hello",
    "html_content": "<h1>Test</h1>",
    "cc": "admin@mmrunners.org",
    "email_type": "test",
    "member_id": "MMR123",
    "metadata": {"custom": "value"}
  }'
```

**Response (success):**
```json
{
  "ok": true,
  "email_id": "EM-1711234567890-1234",
  "logged": true,
  "status": "sent",
  "recipient": "user@example.com"
}
```

**Response (failure):**
```json
{
  "ok": false,
  "email_id": "EM-1711234567890-5678",
  "error": "Missing recipient email",
  "logged": true
}
```

## Removing Old Code

After verification, these files can be removed (no longer needed):
- `mmr-admin/email_client.py` — replaced by webhook_client.py
- Any `.env` files with `AZURE_COMMUNICATION_SERVICES_CONNECTION_STRING`
- Azure Communication Services resource (optional, if not used elsewhere)

## Support

- GAS logs: Apps Script → Execution log → filter `[email_hook]`
- Python logs: Check mmr-admin Azure App Service logs
- Email Log: Always check Email Log sheet for delivery status & errors
