# Email Sending Debug Guide

## Overview

Sync operations now include **comprehensive email logging** so you can see exactly what's happening when reports are sent to `admin@mmrunners.org`.

The system logs:
- Whether Azure Communication Services connection is configured
- Email recipient, subject, and timestamp
- Success/failure status
- Error messages if sending fails

## Check Email Status in Python Code Editor

### Workflow 1: Check if emails are being logged

Go to **Admin Portal** → **Python Code** tab:

```python
# Query sync logs to see if email was attempted
results = query("""
  SELECT id, action, status, created_at, log
  FROM sync_log
  WHERE action IN ('members_to_sheets', 'events_to_sheets', 'payments_to_sheets')
  ORDER BY created_at DESC
  LIMIT 5
""")

for log in results:
    print(f"\nAction: {log['action']}")
    print(f"Status: {log['status']}")
    print(f"Time: {log['created_at']}")

    # Check if email section is in log
    if '📧' in log['log']:
        print("✓ Email sending was attempted")
        # Extract email lines
        for line in log['log'].split('\n'):
            if '📧' in line or '✅' in line or '❌' in line:
                print(f"  {line}")
    else:
        print("✗ No email sending logged")
```

### Workflow 2: Test email sending directly

```python
from email_client import send_email

# Test send email directly
result = send_email(
    to='admin@mmrunners.org',
    subject='Test Email from Python Code Editor',
    html_content='<p>This is a test email from Python Code Editor</p><p>If you see this, email is working!</p>'
)

print(f"Success: {result.get('success')}")
print(f"Status: {result.get('status')}")
print(f"Message: {result.get('message')}")
if result.get('error'):
    print(f"Error: {result.get('error')}")
```

### Workflow 3: Check Azure configuration

```python
import os

# Check if Azure Communication Services is configured
connection_string = os.environ.get('AZURE_COMMUNICATION_SERVICES_CONNECTION_STRING')

if connection_string:
    print("✅ AZURE_COMMUNICATION_SERVICES_CONNECTION_STRING is set")
    # Show partial connection string (masked for security)
    display = connection_string[:30] + "..." if len(connection_string) > 30 else connection_string
    print(f"   Value (partial): {display}")
else:
    print("❌ AZURE_COMMUNICATION_SERVICES_CONNECTION_STRING is NOT set")
    print("   Check App Settings in Azure Portal")
```

### Workflow 4: View email log for a specific sync

```python
# After running a sync, check the full log
results = query("""
  SELECT log FROM sync_log
  WHERE action = 'members_to_sheets'
  ORDER BY created_at DESC
  LIMIT 1
""")

if results:
    full_log = results[0]['log']

    # Extract just the email section
    print("=== EMAIL SENDING LOG ===")
    for line in full_log.split('\n'):
        if '📧' in line or 'Email' in line or 'email' in line or '✅' in line or '❌' in line:
            print(line)
```

## Troubleshooting

### Issue: "AZURE_COMMUNICATION_SERVICES_CONNECTION_STRING not set"

**Check:**
```python
import os
cs = os.environ.get('AZURE_COMMUNICATION_SERVICES_CONNECTION_STRING')
if cs:
    print("Set")
else:
    print("Not set - add to Azure App Settings")
```

**Fix:**
1. Go to Azure Portal → App Service → Settings → Configuration
2. Add new app setting:
   - Name: `AZURE_COMMUNICATION_SERVICES_CONNECTION_STRING`
   - Value: Your Azure Communication Services connection string
3. Save and restart the app service

### Issue: "Failed to send email"

**Check the error message:**
```python
from email_client import send_email

result = send_email(
    to='admin@mmrunners.org',
    subject='Test',
    html_content='<p>Test</p>'
)

if not result.get('success'):
    print(f"Error: {result.get('error')}")
```

**Common errors:**
- `Invalid connection string` → Check Azure Portal for correct value
- `Unauthorized` → Connection string may have expired
- `Service unavailable` → Azure Communication Services may be down
- `Invalid email address` → Verify recipient email is valid

### Issue: Email sent but never received

**Check:** Might be in spam folder
- Gmail: Check Spam folder, mark as "Not Spam"
- Outlook: Check Junk folder

**Check:** Email log shows success
```python
from email_client import send_email

result = send_email(
    to='your-test-email@example.com',
    subject='Test from Python',
    html_content='<p>Test email</p>'
)

print(f"Success: {result['success']}")
print(f"Status: {result['status']}")
print(f"Message: {result['message']}")
```

## Email Log Output Example

When a sync runs successfully, the log now includes:

```
📧 Sending sync report email...
   To: admin@mmrunners.org
   Operation: MySQL → Google: Members
   Subject: MMR Sync Report: MySQL → Google: Members
   ✅ Email sent to admin@mmrunners.org (status: Sent)
   Status: Sent
```

If email fails:

```
📧 Sending sync report email...
   To: admin@mmrunners.org
   Operation: MySQL → Google: Members
   Subject: MMR Sync Report: MySQL → Google: Members
   ❌ Failed to send to admin@mmrunners.org: AZURE_COMMUNICATION_SERVICES_CONNECTION_STRING not set
```

## Email Details

**Sender:** `DoNotReply@mmr-comm.notification.azure.com`

**Recipients:**
- **To:** `admin@mmrunners.org` (for sync reports)
- **CC:** None for error reports

**Sync reports sent for:**
- Members sync (MySQL → Google)
- Events sync (MySQL → Google)
- Payments sync (MySQL → Google)
- Gmail transactions import (Google → MySQL)

## See Also

- `SYNC_VERBOSE_DEBUG.md` — Debug sync operations
- `SYNC_TAB_ARCHITECTURE.md` — Overall sync design
- Azure Communication Services docs: https://learn.microsoft.com/en-us/azure/communication-services/
