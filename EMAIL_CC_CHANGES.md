# Email CC Changes Summary

## Overview
Updated all user-facing email notifications to CC `admin@mmrunners.org` for audit and oversight purposes.

## Files Modified

### 1. **Web App Email Notifications** (`web-apps/gas/membership/src/email.ts`)
Updated 8 notification functions to include admin CC:

| Function | Email Type | Change |
|----------|-----------|--------|
| `notifyPaymentApproved()` | Payment approval confirmation | Added CC to `${adminEmail}, admin@mmrunners.org` |
| `notifyPaymentRejected()` | Payment rejection notice | Added CC to `${adminEmail}, admin@mmrunners.org` |
| `notifyPaymentExpired()` | Expired payment proof notice | Added CC to `${adminEmail}, admin@mmrunners.org` |
| `notifyAutoGuessMatch()` | Auto-matched payment notification | Added CC to `${adminEmail}, admin@mmrunners.org` |
| `notifyExpirationRepaired()` | Membership expiration correction | Added CC to `${adminEmail}, admin@mmrunners.org` |
| `notifyWelcome()` | New member welcome | Added CC to `${adminEmail}, admin@mmrunners.org` |
| `notifyIncompleteSignup()` | Incomplete registration reminder | Added CC to `${adminEmail}, admin@mmrunners.org` |
| `notifyRenewalReminder()` | Membership renewal reminder | Added CC to `${adminEmail}, admin@mmrunners.org` |

**Pattern Used:** Each function now sends emails with CC set to a comma-separated list containing both the primary admin email and `admin@mmrunners.org`.

---

### 2. **GitHub Actions Workflows** (10 files)
Added `cc: 'admin@mmrunners.org'` to all `dawidd6/action-send-mail@v3` steps:

#### Workflow-Specific Changes

**sync-nyrr-weekly.yml**
- ✅ Failure notification (line 143)
- ✅ Success notification (line 279)

**sync-all-sheets-ordered.yml**
- ✅ Email notification step (line 268)

**auto-guess-payments.yml**
- ✅ Notification step (line 120)

**sync-members-recurring.yml**
- ✅ Failure notification (line 85)
- ✅ Success notification (line 152)

**sync-payments-recurring.yml**
- ✅ Failure notification (line 85)
- ✅ Success notification (line 109)

**sync-gmail-transactions-recurring.yml**
- ✅ Failure notification (line 85)
- ✅ Success notification (line 107)

**update-member-status.yml**
- ✅ Failure notification (line 141)

**db-schema-drift.yml**
- ✅ Drift alert email (line 88)
- ✅ Failure notification (line 127)

**sync-webapp-events-recurring.yml**
- ✅ Failure notification (line 84)
- ✅ Success notification (line 107)

**sync-gmail-transactions-recurring.yml**
- ✅ Failure notification (line 85)
- ✅ Success notification (line 107)

---

## Email Types Now CC'd to Admin

### User-Facing Notifications (from GAS)
- 🎉 Payment approved confirmations
- ❌ Payment rejection notices
- ⏰ Expired payment submission reminders
- ✅ Auto-matched payment notifications
- 📝 Membership expiration corrections
- 👋 New member welcome emails
- 📝 Incomplete signup reminders
- 🔄 Membership renewal reminders

### System Notifications (from GitHub Actions)
- ✓ Sync completion confirmations (all sheet syncs)
- ❌ Sync failure alerts (all sync workflows)
- 🤖 Auto-guess payment matching results
- ⚠️ Database schema drift detection alerts
- 📅 Recurring workflow status updates

---

## Impact Analysis

**Total Email Sending Points Updated:** 18+
- **GAS Functions:** 8 user-facing notification functions
- **GitHub Actions Steps:** 10+ email notification steps across 9 workflows

**CC Recipient:** `admin@mmrunners.org`

**Backward Compatibility:** ✅ Full—existing `adminEmail` config value is preserved and still included in CC list. The format is now `${adminEmail}, admin@mmrunners.org`, allowing for multiple admin recipients.

---

## Testing Recommendations

1. **GAS Emails:** Test each notification trigger in development (approve payment, reject payment, etc.) and verify admin receives CC
2. **GitHub Actions:** Manually trigger a workflow and verify admin@mmrunners.org receives CC'd email
3. **Email Client:** Verify emails are not flagged as spam due to multiple recipients

---

## Notes

- All changes maintain backward compatibility—existing admin email configurations continue to work
- The CC implementation uses comma-separated addresses, which is standard email practice
- No changes to email content, timing, or logic—only recipient list expansion
- All modifications completed as of March 29, 2026
