# Google Sheets Reference

**Source of truth**: `/web-apps/gas/membership/src/config.ts`
**Last updated**: March 2026

⚠️ **Column names are case-sensitive PascalCase. Spacing and hyphens in sheet names are exact.**

---

## Two Separate Spreadsheets

| Spreadsheet | Env var | Contains |
|-------------|---------|---------|
| Membership | `GOOGLE_SHEETS_MEMBERSHIP_ID` | Main, WebApp-Events, Payment-History |
| Gmail | `GMAIL_TRANSACTION_SHEET_ID` | Active |

---

## Main Sheet (Members)

**Sheet name**: `Main`

| Index | Column Name | Type | Notes |
|-------|------------|------|-------|
| 0 | MemberID | Text | Auto-generated — leave header, don't fill |
| 1 | Status | Text | `active` / `not active` / `pending_upgrade` |
| 2 | Created | Date | Auto-managed |
| 3 | Expiration | Date | When membership expires |
| 4 | Email | Email | **Primary key** — must be unique |
| 5 | FirstName | Text | PascalCase, no space |
| 6 | LastName | Text | PascalCase, no space |
| 7 | Type | Text | `Individual` / `Family` |
| 8 | FamilyID | Text | Auto-generated; null if Individual |
| 9 | Gender | Text | `M` / `F` — optional |
| 10 | WeChatID | Text | Optional |
| 11 | District | Text | Optional |
| 12 | WebApp | Text | `Yes` / `No` |
| 13 | PaymentCheck | Text | `Yes` / `No` |
| 14 | Info | Text | Optional |
| 15 | LastUpdated | Date | Auto-managed |
| 16 | MembershipFeePaid | Decimal | Amount paid |
| 17 | PaymentDate | Date | When paid |
| 18 | PaymentTransaction | Text | Reference ID |
| 19 | JoinYear | Number | 4-digit year |
| 20 | PhoneNumber | Text | Optional |
| 21 | LastLoginDate | Date | Auto-managed |
| 22 | ProfileLastUpdated | Date | Auto-managed |
| 23 | Notes | Text | Optional |
| 24 | NYRRRunnerName | Text | For NYRR bib lookup (renamed from NYRRMemberName in v4) |
| 25 | YearBorn | Number | Birth year for NYRR bib disambiguation |

**Do NOT fill**: MemberID, Created, LastUpdated, LastLoginDate, ProfileLastUpdated, FamilyID

---

## WebApp-Events Sheet

**Sheet name**: `WebApp-Events` (hyphen required)

| Index | Column Name | Type | Notes |
|-------|------------|------|-------|
| 0 | EventID | Text | Auto-generated |
| 1 | EventType | Text | `dues_payment` / `family_switch` / `family_upgrade` / `membership_application` / `admin_request` |
| 2 | Timestamp | DateTime | Auto-generated |
| 3 | ExpiresAt | DateTime | Auto-calculated |
| 4 | MemberID | Text | Reference to members |
| 5 | Email | Email | Member email |
| 6 | PaymentIntent | Text | `Individual Membership` / `Family Membership` / `Family Upgrade` |
| 7 | Amount | Number | |
| 8 | PaymentMethod | Text | `Zelle` / `Venmo` / `PayPal` |
| 9 | PayerName | Text | |
| 10 | MemoField | Text | |
| 11 | Last4Digits | Text | |
| 12 | FamilyMemberEmails | Text | Comma-separated for family plans |
| 13 | Status | Text | `Pending` / `Matched` / `Approved` / `Rejected` / `Expired` / `Error` |
| 14 | MatchedMessageId | Text | FK → gmail_transactions |
| 15 | MatchedTransactionNumber | Text | Zelle/Venmo reference |
| 16 | AdminApprover | Email | |
| 17 | ApprovalDate | DateTime | |
| 18 | Notes | Text | |
| 19 | PaymentDate | Date | |
| 20 | ScreenshotFileId | Text | Google Drive file ID |
| 21 | GDriveFilePath | Text | |
| 22 | OCRText | Text | |
| 23 | OCRTimestamp | DateTime | |

**Do NOT fill**: EventID, Timestamp, ExpiresAt, MatchedMessageId, Status, ApprovalDate

---

## Payment-History Sheet

**Sheet name**: `Payment-History` (hyphen required)

| Index | Column Name | Type | Notes |
|-------|------------|------|-------|
| 0 | PaymentID | Text | Auto-generated |
| 1 | EventID | Text | FK → WebApp-Events |
| 2 | MemberID | Text | FK → members |
| 3 | PaymentDate | Date | |
| 4 | Amount | Number | |
| 5 | PaymentIntent | Text | `Individual Membership` / `Family Membership` / `Family Upgrade` |
| 6 | PaymentMethod | Text | `Zelle` / `Venmo` / `PayPal` |
| 7 | PayerName | Text | |
| 8 | MemoField | Text | |
| 9 | Last4Digits | Text | |
| 10 | TransactionReference | Text | Zelle/Venmo/PayPal ref |
| 11 | PeriodStart | Date | |
| 12 | PeriodEnd | Date | |
| 13 | ProcessedBy | Email | |
| 14 | ProcessedDate | Date | |
| 15 | Source | Text | `WebApp` / `Admin-Created` / `Import` |
| 16 | Notes | Text | |

**Do NOT fill**: PaymentID

---

## Active Sheet (Gmail Transactions)

**Sheet name**: `Active`
**Spreadsheet**: GMAIL_TRANSACTION_SHEET_ID (separate from membership spreadsheet)

| Index | Column Name | Type | Notes |
|-------|------------|------|-------|
| 0 | Timestamp | DateTime | When email received |
| 1 | Sender | Email | Payer's email |
| 2 | Amount | Number | |
| 3 | Memo | Text | |
| 4 | TransactionDate | Date | |
| 5 | TransactionNumber | Text | Zelle confirmation or Venmo ID |
| 6 | MessageId | Text | **Primary key** — Gmail message ID |
| 7 | Subject | Text | Email subject |
| 8 | OriginalMemo | Text | Full memo text |
| 9 | Notes | Text | |
| 10 | Processed | Boolean | `FALSE` / `TRUE` |
| 11 | Source | Text | `Zelle` / `Venmo` / `Other` |
| 12 | WebAppEventId | Text | FK → WebApp-Events when matched |

**Do NOT fill**: WebAppEventId, Processed (auto-managed)

---

## Verification Checklist

Before syncing, run through this:

```bash
# Run locally to check structure
source basecamp/load-env.sh
python3 basecamp/ops/sync_sheets_to_mysql.py \
  --sheet "Main" \
  --spreadsheet-id "$GOOGLE_SHEETS_MEMBERSHIP_ID" \
  --dry-run
```

Manual checks:
- [ ] Sheet tab names are exactly: `Main`, `WebApp-Events`, `Payment-History`, `Active`
- [ ] Column headers are PascalCase with no spaces (e.g., `FirstName` not `First Name`)
- [ ] At least 1 data row exists in each sheet
- [ ] Key columns have values: Email (Main), EventID (WebApp-Events), PaymentID (Payment-History), MessageId (Active)
- [ ] Service account email has Viewer access on both spreadsheets
- [ ] No hidden rows or columns

### Common Column Name Mistakes

| ❌ Wrong | ✅ Correct |
|---------|-----------|
| `First Name` | `FirstName` |
| `Last Name` | `LastName` |
| `Payment Check` | `PaymentCheck` |
| `Membership Fee Paid` | `MembershipFeePaid` |
| `Join Year` | `JoinYear` |
| `NYRR Runner Name` | `NYRRRunnerName` |
| `Year Born` | `YearBorn` |

### If syncs succeed but no data appears

1. Check GitHub Actions logs: `https://github.com/admin-mmr/trailhead/actions`
2. Look for `[WARNING]` lines about missing required fields
3. Run a dry-run locally and read the output carefully
4. Verify the spreadsheet IDs in GitHub Secrets match the actual sheet URLs

---

*Source: `/web-apps/gas/membership/src/config.ts` — do not edit column order without updating this file*
