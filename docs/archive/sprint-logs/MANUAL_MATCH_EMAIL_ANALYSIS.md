# Manual Payment Match Email Analysis

## Question
When admin manually matches a payment in the portal, which triggers a membership expiration date change, are those emails in nice HTML form? Do we send emails in those scenarios?

## Answer: **YES to both** ✅

When an admin manually matches a payment (or approves it), the system DOES send beautiful HTML-formatted emails to the member.

---

## Flow Overview

### 1. **Manual Match Request** (Admin Portal)
```
Admin clicks "Match" on a pending payment event
  ↓
POST /api/payments/manual-match { eventId, messageId }
  ↓
mmr-admin/payment_actions.py::manual_match()
```

**Result:** Links the event to a gmail transaction, status becomes `'matched'`
**Email at this step:** ❌ **NO email sent on match alone**

### 2. **Approval** (Admin Portal)
```
Admin clicks "Approve" on a matched event
  ↓
POST /api/payments/approve/<event_id>
  ↓
payment_actions.py::approve_event()
  ↓
payment_handlers.py::dispatch_fulfillment()
  ↓
payment_handlers.py::handle_membership_payment() (for dues/membership)
  ↓
update_member_and_family()
  ↓
update_member_expiration() → UPDATES MYSQL
```

**Result:** Member's expiration date is updated to new date

### 3. **Email Trigger** (Google Apps Script)
```
GAS webhook processes the member update
  ↓
Detects expiration date changed
  ↓
Calls notifyPaymentApproved(memberID, paymentIntent)
  ↓
sendEmail() with HTML template
```

**Email at this step:** ✅ **YES - beautiful HTML email sent**

---

## Email Details

### Email Function: `notifyPaymentApproved()`
**File:** `web-apps/gas/membership/src/email.ts` (lines 66-123)

**Sent to:** Member's email address
**CC to:** Admin email + `admin@mmrunners.org` (as of March 29, 2026)

### Email Template: **HTML** ✅

**Subject:** 🎉 Your MMR membership is confirmed!

**Template sections:**
1. **Header** — MMR logo + branding with purple background (#5c35a8)
2. **Main content** — Personalized greeting with payment confirmation
3. **Member card** — Styled box showing:
   - Member ID (large, bold, purple text)
   - Membership type (Individual/Family)
   - Valid until date
4. **CTA button** — "Go to Member Portal" button with arrow
5. **Footer** — Contact info + link to admin email

### HTML Structure:
- **Fully inlined CSS** — All styles survive email client stripping
- **Responsive design** — Centered content, max-width 560px
- **Professional brand** — Purple color scheme (#5c35a8) matches MMR brand
- **Plain-text fallback** — Included for clients that don't support HTML

**Example HTML snippet:**
```html
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f8f6ff;border:1px solid #e9e3ff;border-radius:10px;margin:0 0 20px;">
  <tr><td style="padding:20px 22px;">
    <div style="font-size:20px;font-weight:800;color:#5c35a8;">${m.memberID}</div>
  </td></tr>
</table>
```

---

## Comparison: Approved vs. Rejected vs. Expired

| Scenario | Email Sent? | Template | HTML? | Details |
|----------|------------|----------|-------|---------|
| **Manual match + Approve** | ✅ YES | `notifyPaymentApproved()` | ✅ | Confirms membership is active |
| **Admin rejects** | ✅ YES | `notifyPaymentRejected()` | ✅ | Red box showing rejection reason |
| **Payment expires (24h)** | ✅ YES | `notifyPaymentExpired()` | ✅ | Reminds to resubmit payment proof |
| **Auto-match found** | ✅ YES | `notifyAutoGuessMatch()` | ✅ | Membership was updated automatically |
| **Expiration repaired** | ✅ YES | `notifyExpirationRepaired()` | ✅ | Membership date was corrected |
| **Manual match only** | ❌ NO | — | — | No email until approval |

---

## Key Points

1. **Manual match alone doesn't send email** — The admin must click "Approve" for the email to trigger
2. **Approval triggers expiration update** — Which then triggers the email via GAS webhook
3. **Email is beautiful HTML** — Not plain text; fully styled with brand colors, cards, buttons
4. **Email is personalized** — Shows member first name, member ID, expiration date, payment type
5. **HTML is robust** — Uses inlined CSS to survive email clients that strip `<head>`
6. **CC includes admin@mmrunners.org** — As of the recent update, all member emails CC the admin inbox
7. **Audit logged** — Every email send is logged in `AUDIT_LOG` table for compliance

---

## When Email is NOT Sent

- ✗ Manual match only (before approval)
- ✗ Event is moved to 'error' status
- ✗ If member not found (logs warning)
- ✗ If email send fails (caught and logged, doesn't crash flow)

---

## Verification Points

To confirm emails are actually working:

1. **Test in admin portal:**
   - Create/match a payment for a test member
   - Click "Approve"
   - Check test member's inbox for HTML email with MMR branding

2. **Audit trail:**
   - Check Google Sheets `Audit-Log` sheet
   - Look for rows with `EMAIL_SENT` action
   - Verify `STATE` column shows recipient email + subject

3. **GAS logs:**
   - Open Google Apps Script editor for the GAS project
   - View Execution log for `notifyPaymentApproved` calls
   - Should show `[email] sent to: member@example.com cc: admin@example.com`

---

## Architecture Summary

```
Admin Portal (mmr-admin)
    ↓ approval triggers
Python (payment_handlers.py)
    ↓ updates MySQL member record
    ↓ calls sync_member_to_sheets()
Google Sheets Sync
    ↓ webhook to GAS
Google Apps Script (email.ts)
    ↓ detects expiration change
    ↓ calls notifyPaymentApproved()
    ↓ builds HTML email
    ↓ uses MailApp.sendEmail()
Member's Email Inbox
    ✅ Beautiful HTML email received
```
