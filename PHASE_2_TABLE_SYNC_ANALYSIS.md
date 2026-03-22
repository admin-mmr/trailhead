# Phase 2: Identify Tables to Sync for MMR-WebApp Demo

**Date**: March 21, 2026
**Status**: 🔄 Ready to prioritize next sync tasks
**Audience**: Development team (Cathy)

---

## Current Status Summary

### ✅ Phase 1 Complete
- **Members Table**: 616+ members synced from "Main" sheet
- **Schema**: Updated to v4 (NYRRMemberID removed, NYRRRunnerName + YearBorn added)
- **Sync Script**: 5 critical bugs fixed
- **Code Quality**: 0 TypeScript errors, 0 ESLint warnings

### 🔄 Phase 2 Ready
Now that MySQL has real member data, we need to identify which additional tables to sync for the mmr-webapp demo to be fully functional.

---

## Database Tables Overview

### All Tables in MMR Database

| # | Table | Status | Purpose | Source | Priority |
|---|-------|--------|---------|--------|----------|
| 1 | `families` | ⭕ EMPTY | Group members by family | "Families" sheet? | **HIGH** |
| 2 | `members` | ✅ **SYNCED** | Core member data | "Main" sheet | ✅ |
| 3 | `member_log` | ✅ AUTO | Audit trail (auto-generated) | Triggers | ✅ |
| 4 | `otp_tokens` | ⭕ EMPTY | One-time passwords | Runtime | LOW |
| 5 | `password_reset_tokens` | ⭕ EMPTY | Password reset links | Runtime | LOW |
| 6 | `gmail_transactions` | ⭕ EMPTY | Zelle/Venmo payments | "Gmail Data" sheet | **HIGH** |
| 7 | `payment_events` | ⭕ EMPTY | Pending payment submissions | "WebApp-Events" sheet | **HIGH** |
| 8 | `payments` | ⭕ EMPTY | Approved payment history | "Payment-History" sheet | **HIGH** |
| 9 | `activity_log` | ⭕ EMPTY | User portal activity | "WebApp-ActivityLog" sheet | MEDIUM |
| 10 | `config` | ✅ SEEDED | Configuration (prices, settings) | Hardcoded defaults | ✅ |
| 11 | `schema_migrations` | ✅ AUTO | Migration tracking | Triggers | ✅ |

---

## Detailed Analysis: Which Tables Need Syncing

### 🟢 **HIGH PRIORITY** — Essential for Demo Functionality

#### 1. **families** Table
**Current State**: Empty (0 rows)
**Impact**: Members with `FamilyID != NULL` have dangling foreign keys
**Expected Rows**: ~50-100 families
**Google Sheets Source**: TBD (might be derived from "Main" sheet member.FamilyID values)
**Why Important**: Family memberships are a core product offering
**Demo Impact**: Family members can't properly view their family group

**Analysis**:
```sql
-- Current state
SELECT COUNT(*) FROM families;          -- Result: 0
SELECT DISTINCT FamilyID FROM members;  -- Result: ~50 distinct family IDs
```

**Action**: Check if "Families" sheet exists in Google Workspace OR create sync logic to extract unique families from members sheet.

---

#### 2. **payments** Table
**Current State**: Empty (0 rows)
**Impact**: Members can't see their payment history
**Expected Rows**: 500+ payment records
**Google Sheets Source**: "Payment-History" sheet
**Why Important**: Financial records; members need to verify they paid
**Demo Impact**: Payment history shows $0; looks broken

**Columns to Map**:
- `PaymentID` ← Sheet primary key
- `MemberID` ← Link to members table
- `Amount` ← Payment amount
- `PaymentDate` ← When paid
- `MembershipType` ← "Individual" or "Family"
- `PaymentMethod` ← "Zelle" or "Venmo"
- `PeriodStart` / `PeriodEnd` ← Membership validity period
- `Source` ← "WebApp" or "Admin-Created"

**Action**: Create `sync_payments_to_mysql.py` to handle this sheet.

---

#### 3. **gmail_transactions** Table
**Current State**: Empty (0 rows)
**Impact**: Payment reconciliation impossible
**Expected Rows**: 1000+ transactions
**Google Sheets Source**: "Fetch Gmail data" sheet (Active + Archive tabs)
**Why Important**: Detects Zelle/Venmo payments for matching against payment_events
**Demo Impact**: Can't show incoming payment notifications

**Columns to Map**:
- `MessageId` ← Gmail message ID
- `Sender` ← Payer email
- `Amount` ← Payment amount
- `Memo` ← Payment reference (check/Venmo ID)
- `TransactionDate` ← When received
- `Source` ← "Zelle" or "Venmo"
- `IsArchived` ← Active vs Archive tabs

**Action**: Sync must handle large dataset (~1000 rows); consider pagination or batch inserts.

---

#### 4. **payment_events** Table
**Current State**: Empty (0 rows)
**Impact**: Members can't submit payment proofs; admin can't approve payments
**Expected Rows**: 100+ pending events
**Google Sheets Source**: "WebApp-Events" sheet
**Why Important**: Pipeline for payment proof submissions
**Demo Impact**: Payment submission form will show no history

**Columns to Map**:
- `EventID` ← Sheet primary key
- `MemberID` ← Link to members table
- `Email` ← Member email
- `Amount` ← Claimed payment amount
- `PaymentMethod` ← "Zelle" or "Venmo"
- `Status` ← "pending", "approved", "rejected"
- `Notes` ← Admin remarks
- `ScreenshotFileId` ← Google Drive file ID

**Action**: Create `sync_payment_events_to_mysql.py`; handle file references carefully.

---

### 🟡 **MEDIUM PRIORITY** — Useful but Not Blocking Demo

#### 5. **activity_log** Table
**Current State**: Empty (0 rows)
**Impact**: No audit trail for member portal activity
**Expected Rows**: 2000+ events
**Google Sheets Source**: "WebApp-ActivityLog" sheet
**Why Important**: Debugging + compliance audit trail
**Demo Impact**: Admin activity dashboard will be empty

**Note**: This table is mostly write-heavy (portal writes logs on login, payment submit, etc.). You can populate initial data from sheets but expect most new entries to be generated at runtime.

**Action**: Defer to after payment sync works; not blocking demo functionality.

---

### 🔴 **LOW PRIORITY** — Auto-Generated at Runtime

#### 6. **otp_tokens** & **password_reset_tokens**
- **Why Empty**: Generated dynamically when members request OTP or password reset
- **Sync**: Not needed; these are ephemeral
- **Action**: Skip

---

## Recommended Sync Execution Order

Based on demo dependencies and technical complexity:

```
Phase 2.1 (This Week)
├─ [1] families        ← Extract from members.FamilyID OR "Families" sheet
├─ [2] payments        ← Sync from "Payment-History" sheet
└─ [3] payment_events  ← Sync from "WebApp-Events" sheet

Phase 2.2 (Next Week)
├─ [4] gmail_transactions  ← Large dataset; careful error handling
└─ [5] activity_log        ← Nice-to-have; non-blocking

Demo Ready
└─ ✅ MMR-WebApp portal shows real payment history + can submit new payments
```

---

## Data Dependencies

```
members (✅ synced)
├─ families (⭕ needs sync)
├─ payments (⭕ needs sync)
│  └─ payment_events (⭕ needs sync)
│     └─ gmail_transactions (⭕ needs sync)
└─ activity_log (⭕ can defer)
```

A member can't have a complete record until:
1. ✅ Member exists in `members` table (DONE)
2. ⭕ Member's family record exists in `families` table (IF FamilyID exists)
3. ⭕ Member's payment history exists in `payments` table (IF member paid)
4. ⭕ Member's pending payments exist in `payment_events` table (IF submitted)

---

## Google Sheets Data Sources to Confirm

**Action Required**: You need to verify these sheet names/IDs exist in your Google Workspace:

```
[ ] "Main"                   ← Members (✅ confirmed working)
[ ] "Families"               ← Family groupings (need to find/create)
[ ] "Payment-History"        ← Past payments (need to verify)
[ ] "WebApp-Events"          ← Payment submissions (need to verify)
[ ] "Fetch Gmail data"       ← Gmail/Zelle/Venmo (need to verify)
[ ] "WebApp-ActivityLog"     ← Activity log (can defer)
[ ] "Membership-Master-Log"  ← Member audit trail (can defer)
[ ] "OTP"                    ← OTP codes (auto-generated, skip)
[ ] "Config"                 ← Settings (already seeded in MySQL)
```

**Where to Find**: Check your Google Workspace drive at `drive.google.com` → look for "MMR" or "Membership Master" folder → find the master spreadsheet.

---

## Technical Checklist for Next Steps

### Before Starting Sync #2 (families):
- [ ] Confirm "Families" sheet exists OR mapping strategy from members table
- [ ] Check if FamilyID values in members table are valid references
- [ ] Determine `PrimaryMemberID` for each family (if available)

### Before Starting Sync #3 (payments):
- [ ] Find "Payment-History" sheet ID
- [ ] Verify column names match expected schema
- [ ] Check for data type mismatches (especially Amount field)
- [ ] Estimate row count

### Before Starting Sync #4 (payment_events):
- [ ] Find "WebApp-Events" sheet ID
- [ ] Verify ScreenshotFileId can be stored as VARCHAR(255)
- [ ] Check if Status enum matches ("pending", "approved", "rejected")

### Before Starting Sync #5 (gmail_transactions):
- [ ] Find "Fetch Gmail data" sheet ID
- [ ] Check if "Active" + "Archive" are separate tabs or one sheet
- [ ] Verify Amount parsing (might be text like "$50.00")
- [ ] Plan for pagination if >5000 rows

---

## Database Verification Commands

Once each sync completes, run these to verify:

```bash
# After families sync
mysql-mmr -e "SELECT COUNT(*) as family_count FROM families;"
mysql-mmr -e "SELECT COUNT(DISTINCT f.FamilyID) FROM members m LEFT JOIN families f ON m.FamilyID = f.FamilyID WHERE m.FamilyID IS NOT NULL;"

# After payments sync
mysql-mmr -e "SELECT COUNT(*) as payment_count FROM payments;"
mysql-mmr -e "SELECT SUM(Amount) as total_revenue FROM payments;"

# After payment_events sync
mysql-mmr -e "SELECT COUNT(*) as pending_count FROM payment_events WHERE Status = 'pending';"
mysql-mmr -e "SELECT Status, COUNT(*) FROM payment_events GROUP BY Status;"

# After gmail_transactions sync
mysql-mmr -e "SELECT COUNT(*) as transaction_count FROM gmail_transactions;"
mysql-mmr -e "SELECT Source, COUNT(*) FROM gmail_transactions GROUP BY Source;"
```

---

## Summary: What to Do Next

### Immediate Next Steps (Today):

1. **Confirm Google Sheets exist** — List all available sheets in your MMR Workspace spreadsheet
2. **Choose first table to sync** — Start with either:
   - **families** (if sheet exists + simpler structure)
   - **payments** (if more rows exist = better test of batch insert)
3. **Update sync_sheets_to_mysql.py** — Add support for the new sheet

### This Week:

- [ ] Sync families table
- [ ] Sync payments table
- [ ] Sync payment_events table

### Demo Ready:

Once all three ☝️ are complete, run the mmr-webapp and verify:
```
✅ Members can see their payment history
✅ Families section shows family members grouped
✅ Payment submission form pre-populates past events
✅ Dashboard shows member status and renewal date
```

---

## Notes for Future Reference

### Sync Script Pattern (Reusable)

The `sync_sheets_to_mysql.py` already handles:
- Column mapping (Google sheet column → MySQL column)
- Type coercion (strings → dates, decimals)
- Duplicate detection (new vs. existing rows)
- Snapshot management (Azure Blob Storage)
- Error logging + dry-run mode

**To add a new sheet**:
1. Define `column_mapping` dict for new sheet
2. Add new sheet name to `SHEETS_TO_SYNC` list
3. Run: `python3 sync_sheets_to_mysql.py --sheet "New Sheet" --dry-run`
4. Review output, then run without `--dry-run`

### Performance Expectations

Based on Phase 1:
- **members** (616 rows): ~5 seconds
- **payments** (500+ rows): ~5-10 seconds
- **gmail_transactions** (1000+ rows): ~15-30 seconds (large dataset)

All syncs will trigger triggers that auto-log to member_log, so allow extra time.

---

## Questions to Ask Yourself

1. **Which table is most critical for the demo?**
   → Probably **payments** so members can verify they paid

2. **Can families data come from two sources?**
   → Yes: either from dedicated "Families" sheet OR derived from members with same FamilyID

3. **How fresh does activity_log need to be?**
   → Can defer; most new activity is generated at runtime anyway

4. **Should we sync gmail_transactions weekly or daily?**
   → Recommend nightly job via GitHub Actions (like members sync)

---

## Files to Update

Once you've identified which table to sync next:

1. **basecamp/ops/sync_sheets_to_mysql.py**
   - Add new sheet to column_mapping dict
   - Add type coercion if needed (like YearBorn int conversion)

2. **WORK_COMPLETED.md**
   - Document which table synced
   - Record row counts
   - Note any issues encountered

3. **PROJECT_PLAN.md**
   - Update Phase 2 progress
   - Add dates completed

---

## Related Documentation

- `PROJECT_PLAN.md` — High-level roadmap
- `WORK_COMPLETED.md` — Phase 1 completion details
- `SYNC_SETUP.md` — Sync script setup + troubleshooting
- `NEXT_SESSION.md` — Previous session instructions (now outdated)
- `basecamp/ops/sync_sheets_to_mysql.py` — The sync script itself
- `web-apps/mmr-webapp/db/mmr_migration_v*.sql` — Schema migrations

---

**Next Action**: Determine which Google Sheets exist for families, payments, and payment_events. Start with whichever has the most available data or is highest priority for the demo.
