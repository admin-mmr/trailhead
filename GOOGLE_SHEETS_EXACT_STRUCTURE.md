# Exact Google Sheets Structure (From GAS Code)

**Source**: `/web-apps/gas/membership/src/config.ts` — This is the authoritative definition.

⚠️ **Column names are case-sensitive and must match EXACTLY** (PascalCase)

---

## Main Sheet (Membership Master)

**Sheet name**: `Main` (not "Membership Master")

**Spreadsheet**: MEMBERSHIP_SPREADSHEET_ID

**Column order (EXACT - do not change):**

| Index | Column Name | Type | Example | Notes |
|-------|------------|------|---------|-------|
| 0 | MemberID | Text | A0001 | Auto-generated, use header only |
| 1 | Status | Text | active / not active / pending_upgrade | Stored value, not derived |
| 2 | Created | Date | 2026-01-01 | Auto-generated |
| 3 | Expiration | Date | 2026-12-31 | When membership expires |
| 4 | Email | Email | john@example.com | **Primary key** — must be unique |
| 5 | FirstName | Text | John | PascalCase "FirstName" |
| 6 | LastName | Text | Doe | PascalCase "LastName" |
| 7 | Type | Text | Individual / Family | Must be exact value |
| 8 | FamilyID | Text | B001 | Auto-generated, null if individual |
| 9 | Gender | Text | M / F | Optional |
| 10 | WeChatID | Text | john_doe | Optional |
| 11 | District | Text | Manhattan | Optional |
| 12 | WebApp | Text | Yes / No | Optional |
| 13 | PaymentCheck | Text | Yes / No | Optional |
| 14 | Info | Text | Any notes | Optional |
| 15 | LastUpdated | Date | 2026-03-20 | Auto-managed |
| 16 | MembershipFeePaid | Decimal | 30.00 | Amount paid |
| 17 | PaymentDate | Date | 2026-03-20 | When paid |
| 18 | PaymentTransaction | Text | TXN123 | Reference ID |
| 19 | JoinYear | Number | 2020 | 4-digit year |
| 20 | PhoneNumber | Text | 555-1234 | Optional |
| 21 | LastLoginDate | Date | 2026-03-20 | Auto-managed |
| 22 | ProfileLastUpdated | Date | 2026-03-20 | Auto-managed |
| 23 | Notes | Text | Any notes | Optional |
| 24 | NYRRMemberID | Text | 12345 | Optional |
| 25 | NYRRMemberName | Text | john doe | For NYRR lookup |

**Minimum row for first-time sync:**
```
MemberID | Status | Email            | FirstName | LastName | Type       | ...
[empty]  | active | john@example.com | John      | Doe      | Individual | ...
```

**DO NOT include these in Google Sheet** (auto-generated/managed):
- MemberID, Created, LastUpdated, LastLoginDate, ProfileLastUpdated, FamilyID

---

## WebApp-Events Sheet

**Sheet name**: `WebApp-Events` (exact spelling with hyphen)

**Spreadsheet**: MEMBERSHIP_SPREADSHEET_ID

**Column order (EXACT):**

| Index | Column Name | Type | Example | Notes |
|-------|------------|------|---------|-------|
| 0 | EventID | Text | EV-12345 | Auto-generated, use header only |
| 1 | EventType | Text | dues_payment / family_switch / family_upgrade / membership_application / admin_request | Must be exact |
| 2 | Timestamp | DateTime | 2026-03-20T10:30:00Z | When event created |
| 3 | ExpiresAt | DateTime | 2026-03-27T10:30:00Z | Auto-calculated (Timestamp + PaymentProofReviewDays) |
| 4 | MemberID | Text | A0001 | Reference to members table |
| 5 | Email | Email | john@example.com | Member email |
| 6 | PaymentIntent | Text | Individual Membership / Family Membership / Family Upgrade | Exact values |
| 7 | Amount | Number | 30.00 | Payment amount |
| 8 | PaymentMethod | Text | Zelle / Venmo / PayPal | |
| 9 | PayerName | Text | John Doe | Who is paying |
| 10 | MemoField | Text | 2026 Membership | Payment memo |
| 11 | Last4Digits | Text | 4532 | Last 4 digits of account |
| 12 | FamilyMemberEmails | Text | jane@example.com,bob@example.com | Comma-separated for family |
| 13 | Status | Text | Pending / Matched / Approved / Rejected / Expired / Error | Workflow state |
| 14 | MatchedMessageId | Text | abc123 | Reference to gmail_transactions |
| 15 | MatchedTransactionNumber | Text | Zelle123456 | Venmo/Zelle reference |
| 16 | AdminApprover | Email | admin@example.com | Who approved |
| 17 | ApprovalDate | DateTime | 2026-03-21T14:30:00Z | When approved |
| 18 | Notes | Text | Any notes | Optional |
| 19 | PaymentDate | Date | 2026-03-20 | When payment was made |
| 20 | ScreenshotFileId | Text | [Google Drive ID] | Google Drive file ID |
| 21 | GDriveFilePath | Text | /Proof/payment.png | Path in Drive |
| 22 | OCRText | Text | Extracted text | From OCR scan |
| 23 | OCRTimestamp | DateTime | 2026-03-20T15:00:00Z | When OCR ran |

**Minimum row:**
```
EventID | EventType    | MemberID | Email            | PaymentIntent        | Amount | PaymentMethod | Status
[auto]  | dues_payment | A0001    | john@example.com | Individual Membership | 30.00  | Zelle         | Pending
```

**DO NOT include these in Google Sheet** (auto-managed):
- EventID, Timestamp, ExpiresAt, MatchedMessageId, Status, ApprovalDate

---

## Payment-History Sheet

**Sheet name**: `Payment-History` (exact spelling with hyphen)

**Spreadsheet**: MEMBERSHIP_SPREADSHEET_ID

**Column order (EXACT):**

| Index | Column Name | Type | Example | Notes |
|-------|------------|------|---------|-------|
| 0 | PaymentID | Text | PY-12345 | Auto-generated, use header only |
| 1 | EventID | Text | EV-12345 | Reference to WebApp-Events |
| 2 | MemberID | Text | A0001 | Reference to members |
| 3 | PaymentDate | Date | 2026-03-20 | When paid |
| 4 | Amount | Number | 30.00 | Payment amount |
| 5 | PaymentIntent | Text | Individual Membership / Family Membership / Family Upgrade | Exact values |
| 6 | PaymentMethod | Text | Zelle / Venmo / PayPal | How paid |
| 7 | PayerName | Text | John Doe | Who paid |
| 8 | MemoField | Text | 2026 Membership | Payment memo |
| 9 | Last4Digits | Text | 4532 | Last 4 digits |
| 10 | TransactionReference | Text | Zelle123456 | Venmo/Zelle/PayPal ref |
| 11 | PeriodStart | Date | 2026-01-01 | Membership starts |
| 12 | PeriodEnd | Date | 2026-12-31 | Membership ends |
| 13 | ProcessedBy | Email | admin@example.com | Who processed |
| 14 | ProcessedDate | Date | 2026-03-21 | When processed |
| 15 | Source | Text | WebApp / Admin-Created / Import | Where from |
| 16 | Notes | Text | Any notes | Optional |

**Minimum row:**
```
PaymentID | EventID  | MemberID | PaymentDate | Amount | PaymentIntent        | PaymentMethod | PeriodStart | PeriodEnd
[auto]    | EV-12345 | A0001    | 2026-03-20  | 30.00  | Individual Membership | Zelle         | 2026-01-01  | 2026-12-31
```

**DO NOT include** (auto-generated):
- PaymentID

---

## Active Sheet (Fetch Gmail)

**Sheet name**: `Active` (not "Fetch Gmail", just "Active")

**Spreadsheet**: GMAIL_SPREADSHEET_ID (SEPARATE from membership spreadsheet!)

**Column order (EXACT):**

| Index | Column Name | Type | Example | Notes |
|-------|------------|------|---------|-------|
| 0 | Timestamp | DateTime | 2026-03-20T10:30:00Z | When email received |
| 1 | Sender | Email | payer@gmail.com | Email of payer |
| 2 | Amount | Number | 100.00 | Payment amount |
| 3 | Memo | Text | Payment for 2026 | Email memo/subject |
| 4 | TransactionDate | Date | 2026-03-20 | When transaction occurred |
| 5 | TransactionNumber | Text | Zelle123456 or Venmo-abc | Zelle confirmation or Venmo ID |
| 6 | MessageId | Text | abc123def456 | **Gmail message ID** — unique identifier |
| 7 | Subject | Text | [Gmail] Payment received | Email subject |
| 8 | OriginalMemo | Text | Full memo text | Complete memo from email |
| 9 | Notes | Text | Any notes | Optional |
| 10 | Processed | Boolean | FALSE / TRUE | Whether processed |
| 11 | Source | Text | Zelle / Venmo / Other | Payment source |
| 12 | WebAppEventId | Text | EV-12345 | Reference to WebApp-Events when matched |

**Minimum row:**
```
Timestamp            | Sender          | Amount | Memo        | TransactionDate | TransactionNumber | MessageId       | Processed
2026-03-20 10:30 AM | payer@gmail.com | 100.00 | Payment2026 | 2026-03-20      | Zelle123456       | abc123def456    | FALSE
```

**DO NOT include** (auto-managed):
- WebAppEventId (filled when matched), Processed (filled when processed)

---

## Important Notes

### Two Separate Spreadsheets
- **MEMBERSHIP_SPREADSHEET_ID**: Contains Main, WebApp-Events, Payment-History
- **GMAIL_SPREADSHEET_ID**: Contains only the Active sheet (Fetch Gmail)

These are DIFFERENT spreadsheets in the config:
```
MEMBERSHIP_SPREADSHEET_ID = '11SFvgApmDtEv4jz5bTYI9_zEhCFMQAXC4b2z_4s3ljk'
GMAIL_SPREADSHEET_ID = '1rVOvhXzSxCRpWdAw3jYq5tWrYdCYtXmfqblTHP_wPqA'
```

### Column Names Are Case-Sensitive
- ✅ `FirstName` (PascalCase)
- ❌ `firstname`, `first_name`, `First Name`

### Do NOT manually create these columns
- MemberID, EventID, PaymentID (auto-generated)
- Status, Timestamp, ExpiresAt (auto-managed)
- Any "LastXxx", "Created", "Updated" columns (system-managed)

---

## Quick Validation Checklist

Before syncing, verify:

- [ ] "Main" sheet has columns: MemberID, Status, Created, Expiration, Email, FirstName, LastName, Type, FamilyID, Gender, WeChatID, District, WebApp, PaymentCheck, Info, LastUpdated, MembershipFeePaid, PaymentDate, PaymentTransaction, JoinYear, PhoneNumber, LastLoginDate, ProfileLastUpdated, Notes
- [ ] "WebApp-Events" sheet has columns: EventID, EventType, Timestamp, ExpiresAt, MemberID, Email, PaymentIntent, Amount, PaymentMethod, PayerName, MemoField, Last4Digits, FamilyMemberEmails, Status, MatchedMessageId, MatchedTransactionNumber, AdminApprover, ApprovalDate, Notes, PaymentDate, ScreenshotFileId, GDriveFilePath, OCRText, OCRTimestamp
- [ ] "Payment-History" sheet has columns: PaymentID, EventID, MemberID, PaymentDate, Amount, PaymentIntent, PaymentMethod, PayerName, MemoField, Last4Digits, TransactionReference, PeriodStart, PeriodEnd, ProcessedBy, ProcessedDate, Source, Notes
- [ ] "Active" sheet (in GMAIL_SPREADSHEET_ID) has columns: Timestamp, Sender, Amount, Memo, TransactionDate, TransactionNumber, MessageId, Subject, OriginalMemo, Notes, Processed, Source, WebAppEventId
- [ ] At least 1 data row exists in each sheet
- [ ] Key columns (Email, EventID, PaymentID, MessageId) have values

---

Generated from: `/web-apps/gas/membership/src/config.ts`
Date: March 21, 2026
