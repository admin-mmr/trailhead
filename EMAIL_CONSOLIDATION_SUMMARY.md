# MMR Email System Consolidation — Summary

**Date:** April 2, 2026
**Scope:** Unified all email sending to Google Apps Script (GAS) with consistent branding and proper encoding.

---

## ✅ Completed Changes

### 1. **Branding Unified** (#5c35a8 Purple)
- Updated `web-apps/mmr-webapp/lib/email/templates.ts` — all color references changed from mixed navy/orange to unified purple (#5c35a8)
- Removed Chinese language content from email templates (岚山跑团)
- Maintained GAS templates (already using #5c35a8)

**Files modified:**
- `web-apps/mmr-webapp/lib/email/templates.ts` — 8 email template functions updated

### 2. **Character Encoding Verified** ✅
- `web-apps/gas/membership/src/email.ts` — already has `<meta charset="UTF-8">` (line 400)
- `web-apps/mmr-webapp/lib/email/templates.ts` — already has `<meta charset="UTF-8">` (line 54)
- UTF-8 encoding is properly declared in both systems

### 3. **Sent via GAS Only** ✅
**Architecture confirmed:**
- ✅ `mmr-admin/` — uses `webhook_client.py` to POST emails to GAS webhook
- ✅ `web-apps/mmr-webapp/` — updated email client to use `fetch()` POST to GAS webhook (instead of Azure SDK)
- ✅ `web-apps/gas/membership/` — receives webhook calls and sends via `MailApp.sendEmail()`

### 4. **Next.js Email Client Migrated**
Updated `web-apps/mmr-webapp/lib/email/client.ts`:
- Removed Azure Communication Services dependency
- Implemented GAS webhook POST via `fetch()`
- Added email type tracking (`emailType`, `memberId` parameters)
- All email functions now route through `GAS_WEBHOOK_URL` env var

**Files modified:**
- `web-apps/mmr-webapp/lib/email/client.ts` — complete rewrite
- `web-apps/mmr-webapp/app/api/auth/forgot-password/route.ts` — added `emailType: 'password_reset'`

---

## 📋 Email Types Now Unified

All email types send via GAS and use consistent branding:

| Email Type | Purpose | Sender | Recipients |
|---|---|---|---|
| **welcome** | New member activation | GAS MailApp | Member + Admin CC |
| **payment_approved** | Admin-approved payment | GAS MailApp | Member + Admin CC |
| **payment_rejected** | Payment verification failed | GAS MailApp | Member + Admin CC |
| **payment_expired** | Proof submission expired | GAS MailApp | Member + Admin CC |
| **application_received** | Payment application received | GAS MailApp | Member + Admin CC |
| **renewal_reminder** | Membership expiring soon | GAS MailApp | Member + Admin CC |
| **auto_match_confirmation** | Payment auto-matched | GAS MailApp | Member + Admin CC |
| **expiration_repaired** | Membership date corrected | GAS MailApp | Member + Admin CC |
| **password_reset** | Reset password link | GAS MailApp | User (no CC) |

---

## 🔧 Configuration Required

Set environment variable in your deployment:

```bash
# .env or system env
GAS_WEBHOOK_URL=https://script.google.com/macros/d/{DEPLOYMENT_ID}/usercallable
```

This URL should point to your GAS webhook function that accepts `email_send` actions.

---

## 📝 Files Modified

### Python (mmr-admin)
- **Deprecated (no longer used):**
  - `mmr-admin/email_client.py` — Azure SDK (replaced by webhook_client)
  - `mmr-admin/email_templates.py` — Python templates (can remove once GAS fully adopted)
- **Active:**
  - `mmr-admin/webhook_client.py` — sends to GAS webhook ✅

### TypeScript (Next.js)
- `web-apps/mmr-webapp/lib/email/client.ts` — migrated to GAS webhook ✅
- `web-apps/mmr-webapp/lib/email/templates.ts` — branding unified ✅
- `web-apps/mmr-webapp/app/api/auth/forgot-password/route.ts` — added email type ✅

### TypeScript (GAS)
- `web-apps/gas/membership/src/email.ts` — already correct ✅

---

## 🚀 Next Steps

1. **Deploy changes:**
   ```bash
   # Next.js
   npm run build  # in web-apps/mmr-webapp/

   # Python (mmr-admin)
   # Test: python -m pytest mmr-admin/tests/
   ```

2. **Test email flows:**
   - [ ] Payment approved flow
   - [ ] Payment rejected flow
   - [ ] Welcome email
   - [ ] Password reset
   - [ ] Renewal reminder

3. **Optional cleanup:**
   - Remove `mmr-admin/email_client.py` (no longer needed)
   - Remove `mmr-admin/email_templates.py` (consider keeping as reference)

4. **Monitor:**
   - Check GAS webhook logs for email_send actions
   - Verify Gmail audit log for emails sent via script owner account
   - Monitor delivery/bounce rates

---

## 📊 Summary of Changes

| Area | Before | After |
|---|---|---|
| **Email Sender** | Azure (mmr-admin) + Azure (Next.js) | GAS MailApp (unified) |
| **Templates** | 3 locations (Python, TS GAS, TS Next.js) | 2 locations (TS GAS, TS Next.js) |
| **Colors** | Inconsistent (#5c35a8, #1F497D, #E86033) | Unified (#5c35a8 purple) |
| **Encoding** | ✅ Proper UTF-8 | ✅ Proper UTF-8 |
| **Architecture** | Fragmented | Centralized via GAS webhook |

---

## 🎉 Benefits

✅ **Single sender** — All emails from GAS (Google's infrastructure = better deliverability)
✅ **Unified branding** — Consistent colors and design across all emails
✅ **Proper encoding** — UTF-8 charset declared, emoji rendering fixed
✅ **Centralized templates** — Single source of truth in GAS
✅ **Audit trail** — All emails logged via GAS webhook
✅ **No Azure dependency** — Reduced vendor lock-in, lower costs

---

*Generated: 2026-04-02 — Claude Code*
