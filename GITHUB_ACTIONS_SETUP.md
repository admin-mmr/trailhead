# GitHub Actions Recurring Syncs Setup Guide

## Overview

Four automated GitHub Actions workflows have been created to sync your data every 6 hours:

| Workflow | Sheet | Schedule | Offset |
|----------|-------|----------|--------|
| **sync-members-recurring** | "Main" (Members) | Every 6 hours | 00:00, 06:00, 12:00, 18:00 UTC |
| **sync-payments-recurring** | "Payment-History" (Payments) | Every 6 hours | 01:00, 07:00, 13:00, 19:00 UTC |
| **sync-webapp-events-recurring** | "WebApp-Events" | Every 6 hours | 02:00, 08:00, 14:00, 20:00 UTC |
| **sync-gmail-transactions-recurring** | "Active" (Gmail Data) | Every 6 hours | 03:00, 09:00, 15:00, 21:00 UTC |

**Staggered start times** prevent all workflows from running simultaneously, reducing load on GitHub Actions and your database.

---

## Required GitHub Secrets

Go to: **Settings → Secrets and variables → Actions → New repository secret**

### Google Cloud Credentials
- **`GOOGLE_SERVICE_ACCOUNT`** *(required)*
  - Value: Complete JSON from your Google Cloud service account key
  - Format:
    ```json
    {
      "type": "service_account",
      "project_id": "your-project",
      "private_key_id": "...",
      "private_key": "-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n",
      "client_email": "your-sa@your-project.iam.gserviceaccount.com",
      ...
    }
    ```
  - How to get: Google Cloud Console → Service Accounts → Download JSON key

### Google Sheets IDs
- **`GOOGLE_SHEETS_MEMBERSHIP_ID`** *(required for members sync)*
  - Value: The spreadsheet ID from "Main" sheet URL
  - Example: `1a2b3c4d5e6f7g8h9i0j1k2l3m4n5o6p`

- **`GOOGLE_SHEETS_PAYMENTS_ID`** *(required for payments sync)*
  - Value: The spreadsheet ID from "Payment-History" sheet URL

- **`GOOGLE_SHEETS_WEBAPP_EVENTS_ID`** *(required for webapp events sync)*
  - Value: The spreadsheet ID from "WebApp-Events" sheet URL

- **`GMAIL_TRANSACTION_SHEET_ID`** *(required for gmail transactions sync)*
  - Value: The spreadsheet ID from "Active" (Gmail Data) sheet URL

### MySQL Database Credentials
- **`MYSQL_HOST`** *(required)*
  - Value: Your MySQL server hostname
  - Example: `mmr-mysql.mysql.database.azure.com`

- **`MYSQL_USER`** *(required)*
  - Value: MySQL username
  - Example: `mmradmin`

- **`MYSQL_PASSWORD`** *(required)*
  - Value: MySQL password
  - ⚠️ **Important**: Use a secure, strong password

- **`MYSQL_DATABASE`** *(required)*
  - Value: Database name
  - Example: `mmrdb`

### Azure Storage
- **`AZURE_STORAGE_CONNECTION_STRING`** *(required)*
  - Value: Complete connection string for Azure Blob Storage
  - Format: `DefaultEndpointsProtocol=https;AccountName=...;AccountKey=...;EndpointSuffix=core.windows.net`
  - How to get: Azure Portal → Storage Account → Access keys

### Email Notification Settings
- **`MAIL_SERVER`** *(required for failure notifications)*
  - Value: SMTP server hostname
  - Examples: `smtp.gmail.com`, `smtp.office365.com`

- **`MAIL_PORT`** *(required for failure notifications)*
  - Value: SMTP port number
  - Examples: `587` (TLS), `465` (SSL)

- **`MAIL_USERNAME`** *(required for failure notifications)*
  - Value: Email address for SMTP authentication
  - Example: `noreply@yourcompany.com`

- **`MAIL_PASSWORD`** *(required for failure notifications)*
  - Value: SMTP password or app-specific password
  - ⚠️ **Important**: For Gmail, use an App Password (not your main password)

- **`NOTIFICATION_EMAIL`** *(required for failure notifications)*
  - Value: Email address to receive notifications
  - Example: `cathylin@gmail.com` (or your preferred email)

---

## Setup Checklist

### Step 1: Gather Credentials

- [ ] Google Service Account JSON (from Google Cloud Console)
- [ ] Google Sheets IDs for:
  - [ ] Members ("Main" sheet)
  - [ ] Payments ("Payment-History" sheet)
  - [ ] WebApp Events ("WebApp-Events" sheet)
  - [ ] Gmail Transactions ("Active" sheet)
- [ ] MySQL host, username, password, database name
- [ ] Azure Storage connection string
- [ ] SMTP server details (or Gmail App Password)

### Step 2: Create GitHub Secrets

1. Go to your GitHub repository: `https://github.com/admin-mmr/trailhead`
2. Click **Settings**
3. In the left sidebar, go to **Secrets and variables → Actions**
4. Click **New repository secret** for each of these:

**First, add the Google credentials:**
```
Name: GOOGLE_SERVICE_ACCOUNT
Value: (paste your service account JSON)
```

**Then add the Google Sheets IDs:**
```
Name: GOOGLE_SHEETS_MEMBERSHIP_ID
Value: (your members sheet ID)

Name: GOOGLE_SHEETS_PAYMENTS_ID
Value: (your payments sheet ID)

Name: GOOGLE_SHEETS_WEBAPP_EVENTS_ID
Value: (your webapp events sheet ID)

Name: GMAIL_TRANSACTION_SHEET_ID
Value: (your gmail transactions sheet ID)
```

**Then add the MySQL credentials:**
```
Name: MYSQL_HOST
Value: (your MySQL host)

Name: MYSQL_USER
Value: (your MySQL username)

Name: MYSQL_PASSWORD
Value: (your MySQL password)

Name: MYSQL_DATABASE
Value: (your database name)
```

**Then add the Azure Storage credential:**
```
Name: AZURE_STORAGE_CONNECTION_STRING
Value: (your Azure connection string)
```

**Finally, add the email notification settings:**
```
Name: MAIL_SERVER
Value: (your SMTP server)

Name: MAIL_PORT
Value: (your SMTP port, e.g., 587)

Name: MAIL_USERNAME
Value: (your email/SMTP username)

Name: MAIL_PASSWORD
Value: (your SMTP password or app-specific password)

Name: NOTIFICATION_EMAIL
Value: cathylin@gmail.com (or your preferred email)
```

### Step 3: Verify Workflows are Active

1. Go to your repository
2. Click the **Actions** tab
3. You should see these workflows listed:
   - 📊 Recurring Members Sync (Every 6 Hours)
   - 💳 Recurring Payments Sync (Every 6 Hours)
   - 🌐 Recurring WebApp Events Sync (Every 6 Hours)
   - 📧 Recurring Gmail Transactions Sync (Every 6 Hours)

4. Click on each one and verify **Status: Active**

### Step 4: Test Manually (Optional)

1. Click on a workflow (e.g., "Recurring Members Sync")
2. Click the **Run workflow** button
3. Select your branch (should be your main branch)
4. Click **Run workflow**
5. Wait for it to complete and check the results

---

## Email Notification Setup

### Option A: Gmail with App Password (Recommended)

1. Go to [Google Account Settings](https://myaccount.google.com/security)
2. Scroll to **Your Google Account → Security**
3. Enable 2-Factor Authentication (if not already enabled)
4. Go back to **Security → App passwords**
5. Select **Mail** and **Windows Computer** (or your device)
6. Google will generate a 16-character password
7. Copy this password and add as `MAIL_PASSWORD` secret

**Secret values:**
```
MAIL_SERVER=smtp.gmail.com
MAIL_PORT=587
MAIL_USERNAME=cathylin@gmail.com
MAIL_PASSWORD=(your 16-char app password)
```

### Option B: Office 365

```
MAIL_SERVER=smtp.office365.com
MAIL_PORT=587
MAIL_USERNAME=your-email@company.com
MAIL_PASSWORD=(your Office 365 password)
```

### Option C: Custom SMTP Server

Use your email provider's SMTP settings. Common examples:
- SendGrid: `smtp.sendgrid.net:587`
- Mailgun: `smtp.mailgun.org:587`
- AWS SES: `email-smtp.[region].amazonaws.com:587`

---

## Workflow Details

### Execution Schedule

All times are in **UTC**. Adjust times based on your timezone:

```
UTC → EST (UTC-5): Subtract 5 hours
UTC → PST (UTC-8): Subtract 8 hours
UTC → GMT (UTC+0): No change
```

**Daily schedule:**
- **00:00-01:00 UTC**: Members sync starts
- **01:00-02:00 UTC**: Payments sync starts
- **02:00-03:00 UTC**: WebApp Events sync starts
- **03:00-04:00 UTC**: Gmail Transactions sync starts
- *(repeat every 6 hours)*

### What Each Workflow Does

#### sync-members-recurring
- **Source**: Google Sheets "Main" sheet
- **Destination**: MySQL `members` table
- **Key Field**: Email
- **Frequency**: Every 6 hours (00:00, 06:00, 12:00, 18:00 UTC)
- **Timeout**: 15 minutes
- **Notifications**: Email on failure (and optionally on success)

#### sync-payments-recurring
- **Source**: Google Sheets "Payment-History" sheet
- **Destination**: MySQL `payments` table
- **Key Field**: PaymentID
- **Frequency**: Every 6 hours (01:00, 07:00, 13:00, 19:00 UTC)
- **Timeout**: 15 minutes
- **Notifications**: Email on failure (and optionally on success)

#### sync-webapp-events-recurring
- **Source**: Google Sheets "WebApp-Events" sheet
- **Destination**: MySQL `payment_events` table
- **Key Field**: EventID
- **Frequency**: Every 6 hours (02:00, 08:00, 14:00, 20:00 UTC)
- **Timeout**: 15 minutes
- **Notifications**: Email on failure (and optionally on success)

#### sync-gmail-transactions-recurring
- **Source**: Google Sheets "Active" sheet (Gmail Data)
- **Destination**: MySQL `gmail_transactions` table
- **Key Field**: MessageId
- **Frequency**: Every 6 hours (03:00, 09:00, 15:00, 21:00 UTC)
- **Timeout**: 15 minutes
- **Notifications**: Email on failure (and optionally on success)

---

## Monitoring & Logs

### View Workflow Runs

1. Go to your repository
2. Click **Actions** tab
3. Click on a workflow name to see recent runs
4. Click a specific run to see:
   - Execution time
   - Success/failure status
   - Step-by-step logs
   - Uploaded artifacts (sync logs)

### Download Logs

Each workflow uploads its sync logs as artifacts:
- `members-sync-logs`
- `payments-sync-logs`
- `webapp-events-sync-logs`
- `gmail-transactions-sync-logs`

These are retained for **30 days**.

### Common Issues

| Issue | Solution |
|-------|----------|
| Workflow doesn't run | Check that secrets are set correctly |
| "Secret not found" error | Verify secret names match exactly (case-sensitive) |
| MySQL connection fails | Check `MYSQL_PASSWORD` is correct; verify host is accessible |
| Google API error | Verify service account has access to the Google Sheets |
| Email not received | Check SMTP credentials; verify `NOTIFICATION_EMAIL` is correct |

---

## Modifying Schedules

To change how often syncs run, edit the `cron` expression in each workflow file.

### Cron Format
```
minute hour day month day-of-week
  0     0    *    *     *  ← Midnight every day
  0   0,6   *    *     *  ← Every 6 hours (current setup)
  0   */2   *    *     *  ← Every 2 hours
  0  9,17   *    *  1-5   ← 9 AM and 5 PM on weekdays
```

**Examples:**
```yaml
# Run every hour
- cron: '0 * * * *'

# Run every 3 hours
- cron: '0 0,3,6,9,12,15,18,21 * * *'

# Run once daily at 2 AM UTC
- cron: '0 2 * * *'
```

To apply changes:
1. Edit the workflow file in `.github/workflows/`
2. Commit and push to your repository
3. The new schedule takes effect immediately

---

## Manual Trigger

Any workflow can be manually triggered from GitHub:

1. Go to **Actions** tab
2. Click the workflow name
3. Click **Run workflow** button
4. Select your branch
5. Click **Run workflow**

This is useful for:
- Testing after making changes
- Syncing on-demand without waiting for the scheduled time
- Debugging issues

---

## Disabling a Workflow

To temporarily disable a workflow without deleting it:

1. Click **Actions** tab
2. Find the workflow
3. Click the **...** menu
4. Select **Disable workflow**

To re-enable:
1. Click the same workflow
2. Click **Enable workflow**

---

## Next Steps

1. **Complete the setup checklist** above
2. **Test one workflow** manually to ensure it works
3. **Monitor the email notifications** to confirm they're being sent
4. **Check MySQL** after a few syncs to verify data is being populated
5. **Adjust schedules** if needed based on your needs

---

## Support

If you encounter issues:

1. Check the **workflow logs** in GitHub Actions
2. Verify all **GitHub Secrets** are set correctly
3. Test **MySQL connection** manually from your terminal:
   ```bash
   mysql -h $MYSQL_HOST -u $MYSQL_USER -p -D $MYSQL_DATABASE
   ```
4. Test **Google Sheets access** by running a sync script locally
5. Check **email server settings** if notifications aren't arriving

---

**Created**: March 21, 2026
**Workflows**: 4 recurring syncs
**Status**: Ready to deploy
