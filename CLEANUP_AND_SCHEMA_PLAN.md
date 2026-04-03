# Cleanup & Schema Refactor Plan
**Date:** 2026-04-03 | **Goal:** Simplify MySQL architecture for transactions-as-SSOT

---

## Part 1: Documentation Cleanup

### Files to DELETE (stale/duplicate)
These .md files are superseded by current implementation and context:
- `FIX_TRIGGERS_NOW.md` — v10 column renames already deployed
- `FIX_TRIGGER_NAMES_URGENT.md` — same as above
- `STATUS_UPDATE_MANUAL_SQL.md` — historical status update, now captured in _context.md
- `STATUS_DATETIME_FIX_DEPLOYED.md` — historical deployment log
- `BUILD_FIX_EXPLANATION.md` — historical build fix note
- `MEMBERSHIP_FEE_SYNC.md` — endpoint spec (logic now in triggers)
- `CONVERT_WORKFLOWS_TO_GAS.md` — analysis doc, decision made
- `SYNC_REFACTOR_ANALYSIS.md` — analysis only, implementation started
- `GITHUB_ACTIONS_MYSQL_OPERATIONS.md` — replaced by workflow-based approach
- `LASTUPDATED_WRITE_AUDIT.md` — audit note, now closed
- `PYTHON_DATETIME_FIX.md` — deployed, captured in _context.md
- `UNIX_TIMESTAMP_IMPLEMENTATION.md` — reference (keep ✅ for ops)
- `INACTIVE_LOCK_REFERENCE.md` — reference only, low utility
- `SONNET_HANDOFF.md` — handoff note from previous session
- `PROJECT_PLAN.md` — outdated roadmap; real plan is in _context.md and CLAUDE.md

### Files to KEEP (essential architecture)
- `SHARED_MODULES.md` — Documents shared Python modules (sync_engine, nyrr_api)
- `MONOREPO.md` — Directory structure and service overview
- `CHANGELOG.md` — Historical record (append-only)
- `docs/guides/*` — Reference docs (SYNC_ARCHITECTURE, LOCAL_SETUP, HOOKS, etc.)
- `docs/TROUBLESHOOTING.md`, `TESTING.md` — Operational guides

---

## Part 2: Schema Refactor (MySQL)

### Current State
- `payments` table — one-directional source (Gmail → Sheets → MySQL)
- `webapp_events` table — stores pending/matched webapp subscription events
- `gmail_transactions` table — Gmail transaction records linked to payments
- **Problem:** bidirectional sync logic adds complexity; new flow is unidirectional

### 2.1 Rename `webapp_events` → `submissions`
**Rationale:** Name better reflects intent (user payment submissions awaiting admin approval)

**Current columns → Suggested new names:**

| Old | New | Why |
|-----|-----|-----|
| `EventID` | `SubmissionID` | Clearer; not an event |
| `EventType` | `SubmissionType` | e.g., "membership_payment", "donation" |
| `EventCategory` | — | REMOVE (redundant with SubmissionType) |
| `Timestamp` | `SubmittedAt` | Clearer semantics |
| `ExpiresAt` | `ExpirationTime` | Explicit timeout for unpaired subs |
| `MemberID` | — | KEEP as-is |
| `Email` | — | KEEP as-is |
| `PaymentIntent` | — | KEEP (Stripe reference) |
| `Amount` | — | KEEP as-is |
| `PaymentMethod` | — | KEEP as-is |
| `PayerName` | — | KEEP as-is |
| `MemoField` | — | KEEP as-is |
| `Last4Digits` | — | KEEP as-is |
| `FamilyMemberEmails` | — | KEEP as-is |
| `Status` | — | KEEP (pending, matched, approved, rejected, expired, error) |
| `MatchedMessageId` | — | KEEP (FK to gmail_transactions.MessageId) |
| `MatchedTransactionNumber` | — | KEEP (reference to payments.TransactionReference) |
| `AdminApprover` | — | KEEP as-is |
| `ApprovalDate` | `ApprovedAt` | Consistent naming (SubmittedAt, ApprovedAt) |
| `Notes` | — | KEEP as-is |
| `PaymentDate` | — | KEEP as-is |
| `ScreenshotFileId` | `ScreenshotId` | Shorter |
| `GDriveFilePath` | — | KEEP as-is |
| `OCRText` | — | KEEP as-is |
| `OCRTimestamp` | — | KEEP as-is (or rename to `OCRProcessedAt`) |
| `CreatedAt` | — | KEEP as-is |
| `UpdatedAt` | — | KEEP as-is |
| Unix cols | — | KEEP (timestamp_unix, expires_at_unix, approval_date_unix) |

**Migration SQL (ready to run):**
```sql
ALTER TABLE webapp_events RENAME TO submissions;
ALTER TABLE submissions
  CHANGE COLUMN EventID SubmissionID VARCHAR(50) NOT NULL,
  CHANGE COLUMN EventType SubmissionType VARCHAR(50) NOT NULL,
  DROP COLUMN EventCategory,
  CHANGE COLUMN Timestamp SubmittedAt DATETIME NOT NULL,
  CHANGE COLUMN ExpiresAt ExpirationTime DATETIME DEFAULT NULL,
  CHANGE COLUMN ApprovalDate ApprovedAt DATETIME DEFAULT NULL,
  CHANGE COLUMN ScreenshotFileId ScreenshotId VARCHAR(255) DEFAULT NULL;
```

---

## Part 3: Trigger Architecture

### New Automation Rules
**Goal:** Keep MySQL as SSOT; use triggers for derived updates.

#### Rule 1: Payment → Members (Individual & Family)
**Trigger:** `trg_payments_after_insert_update_members`

When INSERT or UPDATE on `payments`:
1. Check if `MembershipType` matches pattern `%Membership%`
2. If yes:
   - Get the inserted/updated payment's `MemberID` and `TransactionReference`
   - Fetch that member's `FamilyID` (if exists)
   - If `FamilyID` is not null: UPDATE all members with same `FamilyID`
   - Else: UPDATE only the target `MemberID`
   - SET:
     - `PaymentDate` = NEW.PaymentDate
     - `PaymentTransaction` = NEW.TransactionReference
     - `MembershipFeePaid` = NEW.Amount
     - `Expiration` = DATE_ADD(NEW.PaymentDate, INTERVAL 1 YEAR)
     - `Status` = 'active'
     - `UpdatedAt` = NOW()
     - `updated_at_unix` = UNIX_TIMESTAMP(NOW())

#### Rule 2: Payment → Gmail Transactions (Link + Metadata)
**Trigger:** `trg_payments_after_insert_update_gmail_link`

When INSERT or UPDATE on `payments`:
1. Look for matching row in `gmail_transactions` WHERE `TransactionNumber` = NEW.TransactionReference
2. If found, UPDATE that row:
   - `PaymentID` = NEW.PaymentID
   - `ProcessedTime` = NOW()
   - `Notes` = concat membership type + member info:
     - For Individual: `"Individual Membership for MemberID"`
     - For Family: `"Family Membership for MemberID (FamilyID: XXXX)"`
   - `SyncedAt` = NOW()

#### Rule 3: Reverse Link (Audit Trail)
**Optional view:** `v_payment_audit` joins payments → gmail_transactions → members for traceability

---

## Part 4: New Sync Flow (Unidirectional)

### Current → New Architecture
```
Old (Bidirectional):
  MySQL ↔ Google Sheets (members, payments, events)
  Gmail → Google Sheets → MySQL (transactions)

New (Unidirectional + Triggers):
  1. MySQL members/payments → Google Sheets (1x daily)
  2. Gmail → Google Sheets (hourly, Apps Script)
  3. Google Sheets → MySQL (1x daily via GitHub Action)
  4. MySQL triggers handle cross-table consistency (automatic)
```

### Changes to Sync Code
1. **Remove bidirectional logic** from `sync_engine.py::compare_sync_rows()`
   - Only support direction='mysql_to_sheets' and direction='sheets_to_mysql'
   - No conflict resolution needed; one side is always SSOT
2. **Simplify webhook listeners** (no competing writes)
3. **GitHub Actions workflow**
   - Phase 1: MySQL members/payments → Sheets (daily at 02:00 UTC)
   - Phase 2: Sheets transactions → MySQL (daily at 02:30 UTC)
   - Remove complex conflict merge logic

---

## Part 5: Implementation Checklist

### Immediate (Before triggers)
- [ ] **Archive old .md files** to `docs/archive/` (keep 15 most recent in _context.md)
- [ ] **Update _context.md** to remove stale sessions; keep last 3 with timestamps
- [ ] **Schema backup** — export current schema before renaming

### Triggers (SQL)
- [ ] **Run migration:** Rename webapp_events → submissions (test on staging first)
- [ ] **Create trigger:** trg_payments_after_insert_update_members
- [ ] **Create trigger:** trg_payments_after_insert_update_gmail_link
- [ ] **Test:** Insert test payment with Individual + Family members; verify cascade
- [ ] **Add to schema snapshot**

### Sync Code (Python)
- [ ] **Refactor sync_engine.py** — remove bidirectional logic
- [ ] **Update api_sheets_sync.py** — simplify 3 sync endpoints (no conflict resolution)
- [ ] **GitHub Actions** — remove merge phases; keep 2-phase (down/up)

### Docs
- [ ] **Archive cleanup** — move old .md files to docs/archive/
- [ ] **Write new guide:** TRIGGERS_ARCHITECTURE.md (explains 3 rules + testing)
- [ ] **Update SYNC_ARCHITECTURE.md** — reflect unidirectional flow

---

## Rollback Plan
If triggers cause issues:
1. Disable triggers: `ALTER TABLE payments DISABLE KEYS;`
2. Revert schema: use schema_snapshot.sql (keep backup of pre-rename version)
3. Run manual sync job: `POST /api/sync/members-to-sheets` (no conflict merge)

---

## Token Cost Estimate
- Archive stale docs: ~100 tokens (file deletion)
- Trigger creation: ~500 tokens (SQL + testing)
- Sync refactor: ~1200 tokens (Python changes + testing)
- **Total:** ~1800 tokens (well within budget for this phase)

**Next:** Run Part 1 cleanup, then proceed to triggers.
