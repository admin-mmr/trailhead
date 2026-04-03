# Architecture Summary: MySQL as SSOT with Native Trigger Automation (V11)

**Date:** 2026-04-03 | **Status:** Planning Phase | **Estimated Implementation:** ~2 sessions

---

## Executive Summary

**Goal:** Simplify transactions workflow and eliminate bidirectional sync complexity by establishing MySQL as SSOT (Single Source of Truth) and using native SQL triggers for automatic cross-table consistency.

**Current state (before V11):**
- Multiple sources of truth (Gmail → Sheets → MySQL with manual reconciliation)
- Bidirectional sync logic adds ~800 lines of Python complexity
- Payment-to-member updates require manual approval button in admin portal
- webapp_events naming confuses intent (looks like real events, not submissions)

**Target state (V11):**
- Clear unidirectional flow: Gmail → Sheets → MySQL
- Native SQL triggers handle payment→member and payment→gmail linking automatically
- Renamed submissions table clarifies that it holds pending user submissions
- No app-level sync conflicts; DB enforces consistency

---

## Part 1: Schema Changes (Immediate)

### Rename Table: webapp_events → submissions
**Why:** Clearer intent—these are pending user payment submissions, not calendar events.

**Impact:** 12 column name changes

```
EventID          → SubmissionID
EventType        → SubmissionType
EventCategory    → (dropped, redundant)
Timestamp        → SubmittedAt
ExpiresAt        → ExpirationTime
ApprovalDate     → ApprovedAt
ScreenshotFileId → ScreenshotId
OCRTimestamp     → OCRProcessedAt
```

**Files to update:**
- `mmr-admin/static/payments.js` (UI references)
- `mmr-admin/api_payments.py` (API field names)
- `basecamp/python/sync_engine.py` (if any references)

**Migration file:** `MIGRATION_V11_TRIGGERS_AND_RENAME.sql`

---

## Part 2: Trigger-Based Automation (3 Triggers)

### Trigger 1: Payment → Members (Automatic Family Sync)
**Fired:** When a new payment is inserted
**Action:** Automatically update member(s) with payment metadata

```
IF payment.MembershipType LIKE '%Membership%' THEN
  IF member.FamilyID IS NOT NULL THEN
    UPDATE all members with same FamilyID
  ELSE
    UPDATE just that one member
  END
  SET PaymentDate, PaymentTransaction, Expiration, Status='active'
END
```

**Benefit:** No app code needed; works for Individual AND Family memberships automatically.

### Trigger 2: Payment → Gmail Transactions (Automatic Linking)
**Fired:** When a new payment is inserted
**Action:** Find matching gmail_transactions by TransactionReference and link it back

```
UPDATE gmail_transactions
SET PaymentID = NEW.PaymentID,
    ProcessedTime = NOW(),
    Notes = "Membership Type for MemberID (FamilyID: XXX)",
    SyncedAt = NOW()
WHERE TransactionNumber = NEW.TransactionReference
```

**Benefit:** Admin doesn't need to manually click "Link" or "Approve"—it's automatic once payment is created.

### Trigger 3: Payment Update Audit (Optional)
**Fired:** When payment is UPDATED (e.g., date/amount correction)
**Action:** Re-sync member expiration in case payment date changed

**Benefit:** Handles edge cases where payment details are corrected after initial insertion.

---

## Part 3: View for Audit & Reporting

### v_payment_audit
**Purpose:** Read-only join view showing payment → gmail link status + member info

**Columns:**
- PaymentID, MemberID, FirstName, LastName, FamilyID, MemberType
- PaymentDate, Amount, MembershipType, TransactionReference
- GmailMessageId, GmailSender, LinkedAt, **LinkStatus** (linked | unlinked)
- PaymentCreatedAt, PaymentProcessedDate

**Use Cases:**
- "Show all unlinked payments" (LinkStatus = 'unlinked')
- "Audit trail: which email triggered this payment?"
- "Reconcile amount mismatches between Gmail and MySQL"

---

## Part 4: Sync Simplification (Python)

### Remove Bidirectional Logic from sync_engine.py

**Currently:**
- `compare_sync_rows()` supports bidirectional comparison
- Conflict resolution logic for competing writes
- 290 lines of complex state machine

**After V11:**
- Only two directions: **mysql_to_sheets** (down) | **sheets_to_mysql** (up)
- No conflict resolution (one side is always SSOT)
- ~100 lines of simplified comparison

### Remove Conflict Resolution from api_sheets_sync.py

**Currently:**
- 3 sync endpoints use complex merge logic
- Sheets wins in some cases, MySQL wins in others (unclear)

**After V11:**
- Phase 1: MySQL → Sheets (simple copy, no conflicts)
- Phase 2: Sheets → MySQL (simple import, no merges)
- Clear ownership: Sheets is only source for transactions; MySQL owns everything else

### GitHub Actions Workflow: 2-Phase (no merge)

**Before:**
```
Phase 1: MySQL → Sheets (members)
Phase 2: MySQL → Sheets (payments)
Phase 3: MySQL → Sheets (events)
Phase 4: Sheets → MySQL (transactions)
Phase 5–8: Merge/conflict resolution logic
```

**After:**
```
Phase 1: MySQL → Sheets (all: members, payments, events)
Phase 2: Sheets → MySQL (transactions only)
Done. Triggers handle cross-table updates.
```

---

## Part 5: New Data Flow (Diagram)

```
Gmail (External)
    ↓
    └─→ Apps Script (hourly)
         ↓
         └─→ Google Sheets (transactions table)
              ↓
              └─→ GitHub Actions (daily 02:30 UTC)
                   ↓
                   └─→ MySQL (INSERT/UPDATE payments)
                        ↓
                        ├─→ Trigger 1: UPDATE members (auto-expire membership)
                        └─→ Trigger 2: UPDATE gmail_transactions (auto-link)
                             ↓
                        Sync complete, no merge logic needed

Sidebar: MySQL → Sheets (daily 02:00 UTC)
  - members, payments, submissions → Sheets (read-only)
  - No conflict merge; Sheets is sync target only
```

---

## Part 6: Implementation Checklist

### Phase 1: Schema (1 session, ~30 min)
- [ ] Backup current schema to `db/backup_pre_v11/`
- [ ] Test rename on staging: `scripts/run-migration.sh db/schema_migrations/MIGRATION_V11_TRIGGERS_AND_RENAME.sql`
- [ ] Verify submissions table + columns in staging
- [ ] Test triggers with sample Individual payment
- [ ] Test triggers with sample Family payment (2+ members with same FamilyID)
- [ ] Verify v_payment_audit view works
- [ ] Update `db/schema_snapshot.sql`
- [ ] Commit: `git add db/schema_snapshot.sql && git commit -m "chore: V11 schema rename & triggers"`

### Phase 2: Code Updates (1 session, ~60 min)
- [ ] Update `mmr-admin/static/payments.js` → use SubmittedAt/ApprovedAt/SubmissionID
- [ ] Update `mmr-admin/api_payments.py` → field renames
- [ ] Update `sync_engine.py` → remove bidirectional logic, support only mysql_to_sheets / sheets_to_mysql
- [ ] Update `api_sheets_sync.py` → remove conflict resolution from 3 endpoints
- [ ] Simplify GitHub Actions workflow (2-phase instead of 8)
- [ ] Run `test_imports.py` to verify all Python imports clean
- [ ] TypeScript check: `npm run build` in web-apps
- [ ] Commit all changes

### Phase 3: Deployment & Testing (30 min)
- [ ] Deploy to staging: `git push origin main`
- [ ] Verify Azure Static Web Apps build succeeds
- [ ] Run admin portal manually:
  - Create test payment in admin → Check members updated
  - Check gmail_transactions linked automatically
  - Check v_payment_audit view shows LinkStatus='linked'
- [ ] Run GitHub Actions manually with `--verbose` flag
- [ ] Spot-check Sync tab in admin portal
- [ ] Deploy to production: blue-green swap

---

## Part 7: Token & Complexity Budget

### Tokens Saved (Post-V11)
- Remove ~800 lines of bidirectional sync Python → **~500 tokens saved**
- Remove conflict resolution logic → **~200 tokens saved**
- Simplified workflow (8 phases → 2) → **~100 tokens saved**
- **Total savings:** ~800 tokens per sync run (compounding)

### Tokens Spent (Implementation)
- SQL migration + triggers: ~500 tokens
- Python refactor: ~1000 tokens
- Code updates + testing: ~500 tokens
- **Total cost:** ~2000 tokens (one-time)

**ROI:** Break-even after 2–3 sync workflow runs

---

## Part 8: Risk Mitigation

### What Could Go Wrong?

| Risk | Mitigation |
|------|-----------|
| Trigger doesn't fire | Test each trigger individually with INSERT statement; check MySQL error log |
| Payment inserts fail | Test with sample data first; ensure FamilyID exists in members table |
| Sync conflicts | Remove conflict resolution logic gradually; test on staging first |
| Gmail transaction not found | Check TransactionNumber matching; may have data quality issues |
| Family members not synced | Verify FamilyID is set in members table; trigger checks `IF family_id IS NOT NULL` |

### Rollback Plan
Keep pre-V11 schema in `db/backup_pre_v11/schema_snapshot.sql`. Rollback SQL provided in migration file.

---

## Part 9: Future Enhancements (Beyond V11)

1. **Payment history view** — Track all payment updates over time (needs audit table)
2. **Automated reminders** — When payment expires, trigger email to member
3. **Webhook to Sheets** — Instead of daily GitHub Actions, real-time push on payment insert
4. **Family bulk operations** — Admin UI to update entire family at once
5. **Payment receipt generation** — Trigger creates PDF receipt on approval

---

## Files Created (This Session)

1. **CLEANUP_AND_SCHEMA_PLAN.md** — 5-part cleanup + schema refactor plan
2. **SCHEMA_DESIGN_DECISIONS.md** — Answers to: View vs Update, Trigger architecture, Submissions rename
3. **MIGRATION_V11_TRIGGERS_AND_RENAME.sql** — Ready-to-run SQL migration
4. **ARCHITECTURE_SUMMARY_V11.md** — This document (architecture overview)

---

## Success Criteria

✅ After V11, you should be able to:
1. Insert a payment → member expiration auto-updates (no app code)
2. Link payment to gmail automatically (no click needed)
3. See full audit trail in v_payment_audit (no manual logging)
4. Run Sheets sync without conflict merge logic
5. Explain the data flow in 30 seconds (Gmail → Sheets → MySQL → triggers)

---

**Next:** Review these documents. If approved, start Phase 1 (schema migration on staging).
