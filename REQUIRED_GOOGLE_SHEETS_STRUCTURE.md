# Required Google Sheets Structure for Syncs

## Members Sheet ("Main")

**Sheet name must be exactly:** `Main`

**Required column headers (case-sensitive, exact spacing):**

| Column Name | Type | Example | Notes |
|-------------|------|---------|-------|
| MemberID | Text | A0001 | **Primary key** — must be unique |
| Email | Text | john@example.com | must be unique |
| FirstName | Text | John | |
| LastName | Text | Doe | |
| Status | Text | active / not active / pending | Must be one of these values |
| Type | Text | Individual / Family | |
| FamilyID | Text | B001 | |
| Gender | Text | Male/ Female | |
| WeChatID | Text | john_doe123 | |
| District | Text | Manhattan | |
| WebApp | Text | Yes / No | |
| Payment Check | Text | Yes / No | |
| Info | Text | Any notes | |
| JoinYear | Number | 2020 | 4-digit year |
| PhoneNumber | Text | 555-1234 | |
| Notes | Text | Any notes | |
| NYRRRunnerName | Text | john doe | For race registration lookup |
| YearBorn | Number | 1985 | 4-digit year (for NYRR disambiguation) |


**Minimum example row:**
```
Email               | First Name | Last Name | Status           | Type       | Gender | ...
john@example.com    | John       | Doe       | active           | Individual | M      | ...
```

**Why syncs fail:**
- ❌ Column header is "Firstname" (no space) → should be "First Name"
- ❌ Column header is "first name" (lowercase) → should be "First Name"
- ❌ Status value is "Active" → should be "active" (lowercase)
- ❌ Type value is "Member" → should be "Individual" or "Family"
- ❌ Email column missing or empty
- ❌ No data in the sheet

---

## Payments Sheet ("Payment-History")

**Sheet name must be exactly:** `Payment-History`

**Required column headers:**

| Column Name | Type | Example | Notes |
|-------------|------|---------|-------|
| PaymentID | Text | PAY-001 | **Primary key** — must be unique |
| MemberID | Text | A0001 | Link to members table (optional — will be looked up) |
| Amount | Number | 100.00 | Numeric value |
| PaymentDate | Date | 2026-03-20 | Format: YYYY-MM-DD |
| MembershipType | Text | Individual Membership / Family Membership | Exact values |
| PaymentMethod | Text | Zelle / Venmo | |
| PayerName | Text | John Doe | Who made the payment |
| MemoField | Text | 2026 Membership | Payment description |
| Last4Digits | Text | 4532 | Last 4 digits of account |
| TransactionReference | Text | TXN123456 | Zelle/Venmo reference ID |
| PeriodStart | Date | 2026-01-01 | Membership period start |
| PeriodEnd | Date | 2026-12-31 | Membership period end |
| ProcessedBy | Text | admin@example.com | Who processed the payment |
| ProcessedDate | Date | 2026-03-20 | When payment was processed |
| Source | Text | WebApp / Admin-Created | Where payment came from |
| Notes | Text | Any notes | Additional information |

**Note:** `EventID` is NOT in the Payments sheet — it's auto-populated from payment_events when matched.

**Minimum example row:**
```
PaymentID | Amount | PaymentDate | MembershipType        | PaymentMethod | PeriodStart | PeriodEnd
PAY-001   | 100.00 | 2026-03-20  | Individual Membership | Zelle         | 2026-01-01  | 2026-12-31
```

---

## WebApp Events Sheet ("WebApp-Events")

**Sheet name must be exactly:** `WebApp-Events`

**Required column headers:**

| Column Name | Type | Example | Notes |
|-------------|------|---------|-------|
| EventID | Text | EVT-001 | **Primary key** — must be unique |
| EventType | Text | PaymentProof | Type of event |
| Email | Text | john@example.com | Member email address |
| PaymentIntent | Text | Individual Membership / Family Membership | What they're paying for |
| Amount | Number | 100.00 | Payment amount |
| PaymentMethod | Text | Zelle / Venmo | |
| PayerName | Text | John Doe | Name of payer |
| MemoField | Text | 2026 Membership | Payment memo/description |
| Last4Digits | Text | 4532 | Last 4 digits of account |
| Status | Text | pending / approved / rejected | Workflow status |
| Notes | Text | Any notes | Additional information |

**Optional columns:**
- `MemberID` — auto-filled from email lookup
- `ScreenshotFileId`, `GDriveFilePath`, `OCRText` — for proof documents
- `FamilyMemberEmails` — comma-separated for family plans

**Minimum example row:**
```
EventID | EventType    | Email            | PaymentIntent            | Amount | PaymentMethod | Status
EVT-001 | PaymentProof | john@example.com | Individual Membership    | 100.00 | Zelle         | pending
```

---

## Gmail Transactions Sheet ("Active")

**Sheet name must be exactly:** `Active`

**Required column headers:**

| Column Name | Type | Example | Notes |
|-------------|------|---------|-------|
| MessageId | Text | abc123def456 | **Primary key** — Gmail message ID, must be unique |
| Sender | Email | payer@gmail.com | Email address of payer |
| Amount | Number | 100.00 | Payment amount |
| Memo | Text | Payment for 2026 | Payment reference/notes |
| TransactionDate | Date | 2026-03-20 | When transaction occurred |
| TransactionNumber | Text | Zelle1234567 / Venmo-abc | Zelle confirmation or Venmo ID |
| Subject | Text | Payment notification | Email subject |
| OriginalMemo | Text | Full original memo | Original full text |
| Source | Text | Zelle / Venmo / Other | Payment method source |
| Notes | Text | Any notes | Additional information |

**Optional columns:**
- `TimeStamp` — when email was received
- `ProcessedTime` — when payment was processed
- `WebAppID` — EventID when matched to payment_events
- `IsArchived` — Yes/No (instead of separate "Archive" sheet)

**Note:** The "Active" vs "Archive" tabs can be combined into one sheet using an `IsArchived` column, OR you can have separate sheets named "Active" and "Archive" and load them separately.

**Minimum example row:**
```
MessageId    | Sender          | Amount | Memo              | TransactionDate | TransactionNumber
abc123def456 | payer@gmail.com | 100.00 | Payment for 2026  | 2026-03-20      | Zelle1234567
```

---

## How to Verify Your Sheets

### Step 1: Open Each Google Sheet

1. Open your Google Sheet
2. Look at the sheet tabs at the bottom
3. Verify the exact names:
   - ✅ `Main` (for members)
   - ✅ `Payment-History` (for payments)
   - ✅ `WebApp-Events` (for events)
   - ✅ `Active` (for Gmail transactions)

### Step 2: Check Column Headers

1. Look at the first row of each sheet
2. For Members ("Main" sheet), verify it has:
   - `Email`
   - `First Name` (with space)
   - `Last Name` (with space)
   - Other columns as listed above

3. **Copy-paste the header exactly** — capitalization and spacing matter!

### Step 3: Check Data Exists

1. Scroll down in each sheet
2. Verify at least 1 row of data exists
3. Check that the Email/PaymentID/EventID/MessageId column has values (not empty)

### Step 4: Verify Service Account Access

1. Check that each sheet is shared with your Google service account:
   - Email: (from your `GOOGLE_SERVICE_ACCOUNT` secret, find the `client_email` field)
   - Permission: Viewer (read-only)

---

## Quick Fix Checklist

If syncs show as "success" but no data synced:

- [ ] Sheet names match exactly (including hyphens, spacing)
- [ ] Column headers match exactly (case and spacing)
- [ ] At least one data row exists in each sheet
- [ ] Email column (members), PaymentID column (payments), etc. have values
- [ ] Service account email is shared on each sheet
- [ ] No hidden rows or columns
- [ ] Date formats are YYYY-MM-DD

If all above are correct and still no sync:

1. Check the workflow logs: https://github.com/admin-mmr/trailhead/actions
2. Look for error messages about missing columns
3. Run locally to debug:
   ```bash
   source load-env.sh
   python3 basecamp/ops/sync_sheets_to_mysql.py \
     --sheet "Main" \
     --spreadsheet-id "$GOOGLE_SHEETS_MEMBERSHIP_ID" \
     --dry-run
   ```

---

## Example: How to Fix Column Names

**If your sheet has:**
```
| Firstname | Lastname | ... |
```

**Change to:**
```
| First Name | Last Name | ... |
```

Steps:
1. Right-click the column header
2. Select "Edit column" or just click and edit
3. Type the exact name from the table above
4. Press Enter

Then re-run the workflow.

---

## Test Your Setup

After verifying all sheets and columns:

1. Go to GitHub Actions: https://github.com/admin-mmr/trailhead/actions
2. Click "💳 Recurring Payments Sync" (or any workflow)
3. Click "Run workflow" button
4. Wait for completion
5. Check logs for success message:
   ```
   [INFO] Inserted X records
   ```
6. Verify in MySQL:
   ```bash
   mysql -h $MYSQL_HOST -u $MYSQL_USER -p$MYSQL_PASSWORD -D $MYSQL_DATABASE \
     -e "SELECT COUNT(*) FROM payments;"
   ```

---

**Once all columns match exactly and data exists in the sheets, the syncs should work!**
