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
