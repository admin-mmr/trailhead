# GitHub Secrets Quick Setup Reference

## 📋 Secrets Needed (11 total)

Copy-paste this into GitHub Settings → Secrets and Variables → Actions:

```
GOOGLE_SERVICE_ACCOUNT
→ Value: Your complete Google service account JSON

GOOGLE_SHEETS_MEMBERSHIP_ID
→ Value: Spreadsheet ID (from "Main" sheet URL)

GOOGLE_SHEETS_PAYMENTS_ID
→ Value: Spreadsheet ID (from "Payment-History" sheet URL)

GOOGLE_SHEETS_WEBAPP_EVENTS_ID
→ Value: Spreadsheet ID (from "WebApp-Events" sheet URL)

GMAIL_TRANSACTION_SHEET_ID
→ Value: Spreadsheet ID (from "Active" sheet URL)

MYSQL_HOST
→ Value: e.g., mmr-mysql.mysql.database.azure.com

MYSQL_USER
→ Value: e.g., mmradmin

MYSQL_PASSWORD
→ Value: Your MySQL password

MYSQL_DATABASE
→ Value: e.g., mmrdb

MAIL_SERVER
→ Value: e.g., smtp.gmail.com

MAIL_PORT
→ Value: e.g., 587

MAIL_USERNAME
→ Value: Your email address

MAIL_PASSWORD
→ Value: For Gmail: 16-char app password (not your main password)

NOTIFICATION_EMAIL
→ Value: cathylin@gmail.com (or your preferred email)
```

## 🔗 How to Get Google Sheets IDs

For each sheet URL like:
```
https://docs.google.com/spreadsheets/d/1a2b3c4d5e6f7g8h9i0j1k2l3m4n5o6p/edit#gid=0
                                      ↑ This is your Spreadsheet ID
```

Copy the long ID and paste it as the secret value.

## ✅ Verify Setup

1. Go to: https://github.com/admin-mmr/trailhead/settings/secrets/actions
2. All 11 secrets should be listed and set
3. Go to: https://github.com/admin-mmr/trailhead/actions
4. All 4 workflows should show "Active"
5. Click on one and try "Run workflow" to test

## 📧 Gmail App Password (Recommended)

If using Gmail:
1. Go to: https://myaccount.google.com/security
2. Enable 2-Factor Auth (if not already enabled)
3. Go to: App passwords
4. Select: Mail + Windows (or your device)
5. Copy the 16-character password
6. Paste as `MAIL_PASSWORD` secret

## 🎯 Success Criteria

- [ ] All 11 secrets are set in GitHub
- [ ] All 4 workflows appear "Active" in the Actions tab
- [ ] At least one manual test run succeeded
- [ ] Scheduled runs are happening at the correct times (check Actions tab)
- [ ] Email notifications are being received

---

**Everything set? You're done!** The syncs will run automatically every 6 hours.
