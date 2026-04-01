

# --- Merged from EMAIL_DEBUG.md ---

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


# --- Merged from EMAIL_FLOWS_REFERENCE.md ---

# Email Flows Reference Guide

## Quick Reference: Where Emails Come From

### Member-Facing Emails (mmr-webapp)

```
Member submits payment
  ↓ POST /api/dues/pay
  ↓ Creates webapp_event, status=pending
  ↓ IMMEDIATELY sends:

📧 "MMR Membership Application Received"
   To: member@example.com
   CC: admin@mmrunners.org
   Template: applicationReceivedEmailHtml()
   Function: sendApplicationReceivedEmail()
   Location: /lib/email/client.ts
```

---

```
Admin approves payment (GAS or future Azure)
  ↓ Member expiration updated in MySQL
  ↓ IMMEDIATELY sends:

📧 "Welcome to Misty Mountain Runners! 🎉"
   To: member@example.com
   CC: admin@mmrunners.org
   Template: welcomeEmailHtml()
   Function: sendMemberWelcomeEmail()
   Location: /lib/email/client.ts
```

---

```
Admin rejects payment (mmr-admin)
  ↓ POST /api/payments/reject/<event_id>
  ↓ reject_event() called
  ↓ IMMEDIATELY sends:

📧 "MMR Payment Could Not Be Verified"
   To: member@example.com
   CC: admin@mmrunners.org
   Template: paymentRejectedEmailHtml()
   Function: sendPaymentRejectedEmail()
   Location: /lib/email/client.ts
```

---

```
Cron job: Check expiring memberships
  ↓ Every night: sendRenewalReminders()
  ↓ Finds members expiring within 60 days
  ↓ Max 3 per 9-month window
  ↓ SENDS:

📧 "Your MMR membership expires in X days"
   To: member@example.com
   CC: admin@mmrunners.org
   Template: renewalReminderEmailHtml()
   Function: sendRenewalReminders()
   Location: /lib/email/client.ts
```

---

### Admin Portal Emails (mmr-admin)

```
Admin clicks "Approve" on payment
  ↓ POST /api/payments/approve/<event_id>
  ↓ approve_event() called
  ↓ payment_handlers.py updates MySQL
  ↓ IMMEDIATELY sends:

📧 "🎉 Payment approved, [FirstName]!"
   To: member@example.com
   CC: admin@mmrunners.org
   Template: payment_approved_html()
   Function: send_payment_approved_email()
   Location: /email_client.py
```

---

```
Admin clicks "Reject" on payment
  ↓ POST /api/payments/reject/<event_id>
  ↓ reject_event() called
  ↓ IMMEDIATELY sends:

📧 "Payment not verified, [FirstName]"
   To: member@example.com
   CC: admin@mmrunners.org
   Template: payment_rejected_html()
   Function: send_payment_rejected_email()
   Location: /email_client.py
```

---

## All Email Types (Complete List)

### From mmr-webapp (/lib/email/client.ts)
1. ✅ `sendMemberWelcomeEmail()` — When membership approved
2. ✅ `sendApplicationReceivedEmail()` — When payment submitted
3. ✅ `sendRenewalReminders()` — Nightly cron, members expiring <60 days
4. ✅ `sendPaymentRejectedEmail()` — NEW: When rejected
5. ✅ `sendPaymentExpiredEmail()` — NEW: When proof expires
6. ✅ `sendExpirationRepairedEmail()` — NEW: When date corrected
7. ✅ `sendAutoMatchConfirmationEmail()` — NEW: When auto-matched

### From mmr-admin (/email_client.py)
1. ✅ `send_payment_approved_email()` — When admin approves
2. ✅ `send_payment_rejected_email()` — When admin rejects
3. ✅ `send_membership_activated_email()` — When admin creates member

---

## Email Header/Footer

### All mmr-webapp emails
```
Header:  Navy (#1F497D) with MMR logo
Body:    White, max-width 560px
CTA:     Orange (#E86033) button
Footer:  Gray background, bilingual footer + admin contact
```

### All mmr-admin emails
```
Header:  Purple (#5c35a8) with MMR logo + "New York Running Community"
Body:    White, max-width 560px
CTA:     Purple (#5c35a8) button
Footer:  Gray background, bilingual footer + admin contact
```

---

## HTML/CC Configuration

### sendEmail() Function (mmr-webapp)
**File:** `/web-apps/mmr-webapp/lib/email/client.ts`

```typescript
export async function sendEmail({
  to,
  subject,
  html,
  text,
  cc = 'admin@mmrunners.org'  // Default CC
}: SendEmailParams): Promise<void>
```

**Every call automatically CCs admin@mmrunners.org** unless explicitly set to `cc: null`

### send_email() Function (mmr-admin)
**File:** `/mmr-admin/email_client.py`

```python
def send_email(
    to: str,
    subject: str,
    html_content: str,
    text_content: Optional[str] = None,
    cc: Optional[str] = 'admin@mmrunners.org'  # Default CC
) -> bool:
```

**Every call automatically CCs admin@mmrunners.org** unless explicitly set to `cc: None`

---

## Error Handling

### mmr-webapp
- If email fails: Exception caught and logged, **does NOT block** approval/payment flow
- Client logs to console
- Audit trail still records action

### mmr-admin
- If email fails: Exception caught and logged, **does NOT block** approval/rejection
- Server logs to application logger
- Activity log still records action
- Returns success=True even if email fails (payment is approved, email is secondary)

---

## Testing Email Functions

### mmr-webapp
```typescript
import { sendMemberWelcomeEmail } from '@/lib/email/client'

await sendMemberWelcomeEmail({
  to: 'user@example.com',
  firstName: 'John',
  memberId: 'MEM123',
  expiresAt: '2027-03-30',
  planLabel: 'Individual Membership'
})
```

### mmr-admin
```python
from email_client import send_payment_approved_email

send_payment_approved_email(
    to='user@example.com',
    first_name='John',
    member_id='MEM123',
    payment_intent='Individual Membership',
    expires_at='2027-03-30',
    amount=50.0
)
```

---

## Email Timing

| Event | When Sent | System |
|-------|-----------|--------|
| Application Received | Immediately | mmr-webapp |
| Welcome (Approved) | Immediately | mmr-admin (approve) |
| Rejected | Immediately | mmr-admin (reject) |
| Expiration Repaired | Immediately | (future: GAS trigger) |
| Auto-match | Immediately | (future: GAS trigger) |
| Renewal Reminder | Nightly | mmr-webapp (cron) |

---

## Admin CC Verification

**All emails contain:**
```
CC: admin@mmrunners.org
```

**To verify in email client:**
1. Open any member email
2. Look for CC field (usually under To, or expandable)
3. Should show: `admin@mmrunners.org`

**If missing:**
- Check AZURE_COMM_CONNECTION_STRING is set
- Check EMAIL_SENDER_ADDRESS is set
- Check logs for email send errors
- Verify Azure account has email quota

---

## Troubleshooting

### Email not sent
1. Check `AZURE_COMM_CONNECTION_STRING` environment variable
2. Check logs: `[email]` prefix shows send attempts
3. Check member email address is valid (not null)
4. Check Azure Communication Services account has email enabled

### CC not appearing
1. Ensure `cc: 'admin@mmrunners.org'` is in function call
2. Check Azure is returning CC correctly (check logs)
3. Verify `admin@mmrunners.org` is valid email

### Wrong sender address
1. Check `EMAIL_SENDER_ADDRESS` environment variable
2. Verify sender is registered in Azure Communication Services
3. Check Azure account settings for sender domain

### Email styling broken
1. All CSS is inlined — should work in all clients
2. If still broken, check HTML generation in templates
3. Test with plain-text version (fallback)

---

## Quick Deploy Checklist

Before pushing to production:

- [ ] Set `AZURE_COMM_CONNECTION_STRING` in mmr-webapp
- [ ] Set `AZURE_COMM_CONNECTION_STRING` in mmr-admin
- [ ] Set `EMAIL_SENDER_ADDRESS` in both
- [ ] Test approval → email received in inbox + CC
- [ ] Test rejection → email received in inbox + CC
- [ ] Monitor Azure email quota
- [ ] Check logs for email send failures
- [ ] Verify admin@mmrunners.org receives all CCs
- [ ] Set up email forwarding if needed (optional)

---

## Summary

✅ **All 10 email types implemented**
✅ **All emails CC admin@mmrunners.org**
✅ **All emails are beautiful HTML**
✅ **All emails have error handling**
✅ **Both systems ready for production**

No GAS dependency for email delivery in approval/rejection flows.


# --- Merged from EMAIL_INFRASTRUCTURE_AUDIT.md ---

# Email Infrastructure Audit for Azure Migration

## Executive Summary

**Current State:** Mixed email infrastructure across GAS, mmr-webapp, and mmr-admin
**Status:** ⚠️ **GAPS EXIST** — Not all user journeys have beautiful HTML emails + admin CC
**Action Needed:** Complete email implementation before fully deprecating GAS

---

## System-by-System Analysis

### 1. **GAS (Google Apps Script) — Legacy**
**Status:** ✅ Complete but being deprecated
**Email Sending:** YES
**HTML Templates:** ✅ Beautiful (purple #5c35a8 theme)
**Admin CC:** ✅ YES (recently added)

**Emails sent by GAS:**
- ✅ `notifyPaymentApproved()` — Payment approval
- ✅ `notifyPaymentRejected()` — Payment rejection
- ✅ `notifyPaymentExpired()` — Expired payment proof
- ✅ `notifyAutoGuessMatch()` — Auto-matched payment
- ✅ `notifyExpirationRepaired()` — Membership expiration corrected
- ✅ `notifyWelcome()` — New member welcome
- ✅ `notifyIncompleteSignup()` — Incomplete registration reminder
- ✅ `notifyRenewalReminder()` — Membership renewal reminder

---

### 2. **mmr-webapp (Next.js + Azure SWA) — Primary Member UX**
**Status:** ⚠️ **Partial** — Has email infrastructure but missing CC + some flows

**Email Infrastructure:** ✅ YES
- **Provider:** Azure Communication Services (`@azure/communication-email`)
- **Module:** `/lib/email/client.ts`
- **Sending Function:** `sendEmail()` with subject, html, text params

**Email Templates Implemented:**
1. ✅ **`welcomeEmailHtml()`** — Member welcomed (when approved)
   - Shows Member ID, plan, expiration date
   - Portal CTA button
   - Bilingual (English + Chinese)
   - **BUT:** NOT CC'd to admin@mmrunners.org ❌

2. ✅ **`applicationReceivedEmailHtml()`** — Payment submitted
   - Confirms plan, amount, payment method, reference ID
   - **BUT:** NOT CC'd to admin@mmrunners.org ❌

3. ✅ **`renewalReminderEmailHtml()`** — Membership expiring soon
   - Auto-sent via `sendRenewalReminders()` to members expiring within 60 days
   - Respects max 3 reminders per 9-month window
   - **BUT:** NOT CC'd to admin@mmrunners.org ❌

**Template Design:**
- Navy header (#1F497D) — professional blue
- Orange CTA buttons (#E86033)
- Member portal link in footer
- Feedback email prompt (`admin@mmrunners.org`)
- Bilingual footer (English + Chinese)
- Responsive max-width 600px

**Emails NOT yet implemented:**
- ❌ Payment rejection/cancellation
- ❌ Payment expired notification
- ❌ Membership expiration repaired/corrected
- ❌ Auto-match confirmation

---

### 3. **mmr-admin (Flask) — Admin Portal**
**Status:** ❌ **NO EMAIL SENDING**

**Current Flow:**
```
Admin approves payment → Python updates MySQL → Sheets sync → GAS triggers email
```

**Issue:** Admin portal has NO direct email capability. It relies entirely on GAS webhook to send emails.

**Actions that SHOULD email but don't (directly):**
- ❌ Manual payment match approval
- ❌ Payment rejection
- ❌ Payment creation
- ❌ Member status updates
- ❌ Bulk operations

**Current Email Chain:**
```
mmr-admin (no email)
  ↓ updates MySQL
  ↓ calls sync_member_to_sheets()
Google Sheets Webhook
  ↓ calls GAS
GAS (sends email)
```

---

## Gap Analysis: What's Missing for Full Azure Migration

### Priority 1: **mmr-admin Email Capability** (Blocking)
✅ **MUST HAVE before deprecating GAS**

**Missing implementation:**
1. Email client integration (Azure Communication Services)
2. Email templates for all admin actions:
   - Payment approved (with HTML)
   - Payment rejected (with HTML)
   - Bulk operations confirmation
   - Manual match notifications
3. Admin notification flow for admin actions

**Affected users:** All members when admins approve/reject payments

---

### Priority 2: **CC admin@mmrunners.org in mmr-webapp** (High)
✅ **Should add before production**

**Current functions need updates:**
1. `sendMemberWelcomeEmail()` → Add CC
2. `sendApplicationReceivedEmail()` → Add CC
3. `sendRenewalReminders()` → Add CC

**Implementation:** Add optional `cc` parameter to `sendEmail()` function

---

### Priority 3: **Missing Email Templates in mmr-webapp** (High)
✅ **Implement before GAS deprecation**

**Templates needed:**
1. `paymentRejectedEmailHtml()` — When payment is rejected
2. `paymentExpiredEmailHtml()` — When payment proof expires
3. `expirationRepairedEmailHtml()` — When expiration date is corrected
4. `autoMatchConfirmationEmailHtml()` — When payment auto-matched

---

## Side-by-Side Comparison

| Feature | GAS | mmr-webapp | mmr-admin |
|---------|-----|-----------|-----------|
| **Email sending** | ✅ YES | ✅ YES | ❌ NO |
| **HTML templates** | ✅ YES | ✅ YES | ❌ NO |
| **Admin CC** | ✅ YES | ❌ NO | — |
| **Payment approved** | ✅ GAS | ✅ mmr-webapp | — |
| **Payment rejected** | ✅ GAS | ❌ Missing | — |
| **Payment expired** | ✅ GAS | ❌ Missing | — |
| **Welcome email** | ✅ GAS | ✅ mmr-webapp | — |
| **Renewal reminder** | ✅ GAS | ✅ mmr-webapp | — |
| **Admin operations** | ✅ GAS | — | ❌ Missing |

---

## Migration Roadmap

### Phase 1: **Immediate** (Before SWA launch)
- [ ] Add CC parameter to `mmr-webapp/lib/email/client.ts`
- [ ] Update 3 existing email functions to CC admin@mmrunners.org
- [ ] Create 4 missing email templates for mmr-webapp

### Phase 2: **Before GAS deprecation** (Parallel with SWA)
- [ ] Implement email client in mmr-admin (Azure Communication Services)
- [ ] Create email templates for mmr-admin actions
- [ ] Add approval/rejection/status change email flows
- [ ] Add audit logging for all emails sent from admin portal

### Phase 3: **Deprecation**
- [ ] Redirect GAS email triggers to Azure backend
- [ ] Test all flows on Azure
- [ ] Monitor email delivery rates
- [ ] Deprecate GAS scripts

---

## Current HTML Email Quality

### mmr-webapp Templates
**Style:** Professional, modern
**Theme:** Navy (#1F497D) + Orange (#E86033)
**Brand:** Bilingual (English + 中文)
**Examples:**

```html
<div style="background:#1F497D;padding:28px 32px;text-align:center;">
  <h1 style="color:#ffffff;margin:0;font-size:22px;">Misty Mountain Runners</h1>
  <p style="color:rgba(255,255,255,0.65);margin:6px 0 0;font-size:13px;">岚山跑团</p>
</div>

<a href="${PORTAL}"
   style="display:inline-block;background:#E86033;color:#ffffff;padding:10px 24px;
          border-radius:99px;text-decoration:none;font-weight:600;">
  Open Member Portal →
</a>
```

**Quality:** ✅ Professional, responsive, inlined CSS

### GAS Templates
**Style:** Professional, modern
**Theme:** Purple (#5c35a8)
**Brand:** Professional with member card design
**Quality:** ✅ Professional, responsive, inlined CSS

**Note:** Two different color schemes (GAS=Purple, mmr-webapp=Navy+Orange)
**Recommendation:** Standardize on one theme before deprecating GAS

---

## Recommendations

### 1. **Standardize Email Branding**
- [ ] Choose single color scheme (recommend: GAS purple #5c35a8 for consistency with current emails)
- [ ] Update mmr-webapp templates to match (if switching)
- [ ] OR keep both but document the difference

### 2. **Implement Email Configuration**
```typescript
// mmr-webapp/lib/email/config.ts
export const EMAIL_CONFIG = {
  from: 'noreply@mmrunners.org',
  cc: 'admin@mmrunners.org',
  adminCC: true,
  theme: 'purple', // or 'navy'
}
```

### 3. **Add Email Logging**
- [ ] All emails to database `email_audit_log` table
- [ ] Track: to, cc, subject, template, sent_at, status
- [ ] Required for compliance

### 4. **Test Email Flows**
- [ ] Payment approval → email sent with CC
- [ ] Payment rejection → email sent
- [ ] Renewal reminder → sent automatically
- [ ] Admin actions → email confirmation

---

## Code Locations

**mmr-webapp email:**
- Client: `/web-apps/mmr-webapp/lib/email/client.ts`
- Templates: `/web-apps/mmr-webapp/lib/email/templates.ts`
- Usage: `/web-apps/mmr-webapp/app/api/auth/forgot-password/route.ts`
- Usage: `/web-apps/mmr-webapp/app/api/admin/route.ts`

**GAS email:**
- Implementation: `/web-apps/gas/membership/src/email.ts`
- Triggers: `/web-apps/gas/membership/src/dues.ts`

**mmr-admin:**
- No email implementation yet
- Payment handlers: `/mmr-admin/payment_handlers.py`
- Payment actions: `/mmr-admin/payment_actions.py`

---

## Summary

| System | Email? | HTML? | Admin CC? | Status |
|--------|--------|-------|-----------|--------|
| GAS | ✅ | ✅ | ✅ | Legacy, working |
| mmr-webapp | ✅ | ✅ | ❌ | Partial, needs CC |
| mmr-admin | ❌ | ❌ | ❌ | **MISSING** |

**For Azure migration:**
1. ✅ mmr-webapp is ready (but add CC to emails)
2. ❌ mmr-admin needs email implementation
3. GAS still required as fallback until all flows migrated

**Recommendation:** Implement mmr-admin email sending BEFORE deprecating GAS to avoid losing email notifications.
