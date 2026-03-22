# Schema Updates Summary

## Changes Made

### 1. Removed NYRR Columns from Verification

**Why:** The migration v4 indicates that `NYRRMemberID` was dropped and `NYRRMemberName` was renamed to `NYRRRunnerName`. Your actual Google Sheets don't have these columns, so the verification script was incorrectly checking for them.

**Updated Files:**
- `basecamp/ops/verify_sheets_structure.py` - Removed `NYRRMemberID` and `NYRRMemberName` from expected Main sheet headers

**New Expected Main Sheet Headers (24 columns):**
```
MemberID, Status, Created, Expiration, Email,
FirstName, LastName, Type, FamilyID, Gender,
WeChatID, District, WebApp, PaymentCheck, Info,
LastUpdated, MembershipFeePaid, PaymentDate, PaymentTransaction,
JoinYear, PhoneNumber, LastLoginDate, ProfileLastUpdated, Notes
```

---

### 2. Added ProfileLastUpdated to Members Table

**Purpose:** Track when member profile was last updated in Google Sheets

**Created:**
- `web-apps/mmr-webapp/db/mmr_migration_v5.sql` - Migration script
- Updated `basecamp/ops/mmr_migration_consolidated.sql` - For fresh database setups

**Database Changes:**
```sql
ALTER TABLE members
    ADD COLUMN IF NOT EXISTS ProfileLastUpdated DATETIME NULL
    COMMENT 'When member profile was last updated (from Google Sheets)'
    AFTER LastLoginDate;
```

**Google Sheets Column Mapping:**
- Main sheet: `ProfileLastUpdated` column → members.ProfileLastUpdated

---

### 3. Added PaymentIntent to Payments Table

**Purpose:** Track the payment intent from webapp_events (links payment to specific payment request)

**Created:**
- `web-apps/mmr-webapp/db/mmr_migration_v5.sql` - Migration script
- Updated `basecamp/ops/mmr_migration_consolidated.sql` - For fresh database setups

**Database Changes:**
```sql
ALTER TABLE payments
    ADD COLUMN IF NOT EXISTS PaymentIntent VARCHAR(100) NULL
    COMMENT 'Payment intent ID (from webapp_events)'
    AFTER Amount;
```

**Google Sheets Column Mapping:**
- Payment-History sheet: `PaymentIntent` column → payments.PaymentIntent

---

## Next Steps

### 1. Run the Migration (if using existing database)

If your database already exists, run the migration to add the new columns:

```bash
# Connect to your MySQL database and run:
mysql -h mmr-mysql.mysql.database.azure.com -u mmradmin -p \
      --ssl-mode=REQUIRED mmrdb < web-apps/mmr-webapp/db/mmr_migration_v5.sql
```

### 2. Verify Columns Were Added

```bash
# Verify the new columns exist
mysql -h mmr-mysql.mysql.database.azure.com -u mmradmin -p mmrdb -e \
  "SELECT COLUMN_NAME, DATA_TYPE FROM information_schema.COLUMNS
   WHERE TABLE_NAME IN ('members', 'payments')
   AND COLUMN_NAME IN ('ProfileLastUpdated', 'PaymentIntent');"
```

Should show:
```
COLUMN_NAME           DATA_TYPE
ProfileLastUpdated    datetime
PaymentIntent         varchar(100)
```

### 3. Verify Google Sheets Have These Columns

Run the verification script:
```bash
cd basecamp
./verify-sheets.sh
```

Should show:
- ✓ ProfileLastUpdated found in Main sheet
- ✓ PaymentIntent found in Payment-History sheet

### 4. Test the Sync

```bash
cd basecamp

# Test Members sync (will now sync ProfileLastUpdated)
./run-sync.sh Main members --dry-run

# Test Payments sync (will now sync PaymentIntent)
./run-sync.sh Payment-History payments --dry-run
```

---

## Column Order Reference

### Main Sheet (Members Table) - 24 columns
```
 1. MemberID
 2. Status
 3. Created
 4. Expiration
 5. Email
 6. FirstName
 7. LastName
 8. Type
 9. FamilyID
10. Gender
11. WeChatID
12. District
13. WebApp
14. PaymentCheck
15. Info
16. LastUpdated
17. MembershipFeePaid
18. PaymentDate
19. PaymentTransaction
20. JoinYear
21. PhoneNumber
22. LastLoginDate
23. ProfileLastUpdated  ← NEW
24. Notes
```

### Payment-History Sheet (Payments Table) - 17 columns
```
 1. PaymentID
 2. EventID
 3. MemberID
 4. PaymentDate
 5. Amount
 6. PaymentIntent      ← NEW
 7. PaymentMethod
 8. PayerName
 9. MemoField
10. Last4Digits
11. TransactionReference
12. PeriodStart
13. PeriodEnd
14. ProcessedBy
15. ProcessedDate
16. Source
17. Notes
```

---

## Files Modified

1. ✅ `basecamp/ops/verify_sheets_structure.py` - Updated expected columns
2. ✅ `web-apps/mmr-webapp/db/mmr_migration_v5.sql` - NEW migration script
3. ✅ `basecamp/ops/mmr_migration_consolidated.sql` - Added new columns for fresh setups
