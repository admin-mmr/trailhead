# Schema Design Decisions: Views vs Updates, Triggers, and Submissions Table

**Date:** 2026-04-03 | **Context:** Simplifying MySQL for transactions-as-SSOT with trigger-based automation

---

## Q1: After Payment Match — View or Update Raw Record?

### Question
When a payment is matched to a gmail_transaction (linking PaymentID), should we:
- **Option A:** Create a view that joins payments → gmail_transactions for match audit trail
- **Option B:** Update the raw gmail_transactions record with PaymentID + metadata

### Recommendation: **BOTH (Complementary)**

#### Option B (Update Raw Records) — PRIMARY APPROACH
**Use trigger-based updates for operational automation:**

```sql
-- trg_payments_after_insert_update_gmail_link
AFTER INSERT ON payments
  UPDATE gmail_transactions
  SET PaymentID = NEW.PaymentID,
      ProcessedTime = NOW(),
      Notes = CONCAT(NEW.MembershipType, ' for ', NEW.MemberID,
              IF(NEW.MembershipType LIKE '%Family%', CONCAT(' (Family: ', NEW.FamilyID, ')'), '')),
      SyncedAt = NOW()
  WHERE TransactionNumber = NEW.TransactionReference
```

**Pros:**
- Updates are transactional (atomicity)
- No need to join at query time (performance)
- Historical audit trail preserved in single table
- Matches the flow: Gmail email → Sheets → MySQL → automatic link-back

**Cons:**
- One-way update only (payment record doesn't know if it was matched)

#### Option A (View) — COMPLEMENTARY (Read-only Audit)
**Create a join view for transparency + reverse linking:**

```sql
CREATE VIEW v_payment_audit AS
SELECT
  p.PaymentID,
  p.MemberID,
  p.TransactionReference,
  p.MembershipType,
  p.PaymentDate,
  gt.MessageId,
  gt.Sender,
  gt.Amount AS GmailAmount,
  gt.TransactionDate AS GmailDate,
  gt.ProcessedTime AS LinkedAt,
  CASE
    WHEN gt.PaymentID IS NOT NULL THEN 'linked'
    ELSE 'unlinked'
  END AS LinkStatus,
  COALESCE(m.FirstName, 'N/A') AS MemberName
FROM payments p
LEFT JOIN gmail_transactions gt
  ON p.TransactionReference = gt.TransactionNumber
LEFT JOIN members m
  ON p.MemberID = m.MemberID
ORDER BY p.PaymentDate DESC;
```

**Pros:**
- Read-only, no mutation risk
- Shows unlinked payments (LinkStatus = 'unlinked')
- Historical record with member info
- Safe for reporting/audits

**Use cases:**
- Admin dashboard: "Which payments are still unlinked?"
- Audit log: "Trace payment → gmail → member"
- Data quality checks: Amount mismatches, date inconsistencies

---

## Q2: Trigger Recommendations

### Why Use Native SQL Triggers Instead of App Logic?

**Reasons:**
1. **Data consistency:** Enforced at DB layer, not dependent on app code path
2. **Transparency:** Visible to all clients (Python, TypeScript, future APIs)
3. **Auditability:** Recorded in binary log; can replay changes
4. **Reduced app complexity:** No manual sync code needed for these operations

### Proposed Three-Trigger Architecture

#### **Trigger 1: Payment → Members (Family Sync)**
```sql
DELIMITER //
CREATE TRIGGER trg_payments_after_insert_update_members
AFTER INSERT ON payments
FOR EACH ROW
BEGIN
  -- Only process membership payments
  IF NEW.MembershipType LIKE '%Membership%' THEN

    -- Find the member's FamilyID
    DECLARE family_id VARCHAR(10);
    SELECT FamilyID INTO family_id FROM members WHERE MemberID = NEW.MemberID LIMIT 1;

    -- Update entire family if applicable, otherwise just the member
    UPDATE members
    SET
      PaymentDate = NEW.PaymentDate,
      PaymentTransaction = NEW.TransactionReference,
      MembershipFeePaid = NEW.Amount,
      Expiration = DATE_ADD(NEW.PaymentDate, INTERVAL 1 YEAR),
      Status = 'active',
      UpdatedAt = NOW(),
      updated_at_unix = UNIX_TIMESTAMP(NOW())
    WHERE
      (family_id IS NOT NULL AND FamilyID = family_id)
      OR (MemberID = NEW.MemberID AND family_id IS NULL);

  END IF;
END;
//
DELIMITER ;
```

**Handles:**
- Individual: Updates just that member
- Family: Updates all members in the family (spouse + kids all get same expiration)
- Automatic: No app code needed

#### **Trigger 2: Payment → Gmail Transactions (Link Metadata)**
```sql
DELIMITER //
CREATE TRIGGER trg_payments_after_insert_update_gmail_link
AFTER INSERT ON payments
FOR EACH ROW
BEGIN
  -- Link the payment back to the gmail_transactions record
  UPDATE gmail_transactions
  SET
    PaymentID = NEW.PaymentID,
    ProcessedTime = NOW(),
    Notes = CONCAT(
      NEW.MembershipType, ' for ', NEW.MemberID,
      IF(NEW.MembershipType LIKE '%Family%',
         CONCAT(' (FamilyID: ', COALESCE((SELECT FamilyID FROM members WHERE MemberID = NEW.MemberID), 'N/A'), ')'),
         '')
    ),
    SyncedAt = NOW()
  WHERE TransactionNumber = NEW.TransactionReference;
END;
//
DELIMITER ;
```

**Handles:**
- Automatic linking once payment is approved
- Metadata notes include context (membership type, member info)
- Timestamp tracks when payment was processed

#### **Trigger 3 (Optional): Payment Update Audit**
If payments are ever UPDATED (e.g., amount correction, date fix):

```sql
DELIMITER //
CREATE TRIGGER trg_payments_after_update_members
AFTER UPDATE ON payments
FOR EACH ROW
WHEN NEW.MembershipType LIKE '%Membership%' AND NEW.PaymentDate <> OLD.PaymentDate
BEGIN
  -- Re-sync members if payment date changes (membership expiration changed)
  UPDATE members
  SET
    Expiration = DATE_ADD(NEW.PaymentDate, INTERVAL 1 YEAR),
    UpdatedAt = NOW(),
    updated_at_unix = UNIX_TIMESTAMP(NOW())
  WHERE MemberID = NEW.MemberID
     OR (FamilyID = (SELECT FamilyID FROM members WHERE MemberID = NEW.MemberID));
END;
//
DELIMITER ;
```

---

## Q3: webapp_events → submissions Rename + Column Design

### Why Rename?
**EventID/EventType/EventCategory** suggest real-world events (races, meetings).
**SubmissionID/SubmissionType** clarify intent: pending user payment submissions awaiting admin approval.

### Proposed Columns (with rationale)

| Current | New | Type | Rationale |
|---------|-----|------|-----------|
| EventID | SubmissionID | VARCHAR(50) | Clearer: "this is a submission, not an event" |
| EventType | SubmissionType | VARCHAR(50) | Same purpose; rename for consistency |
| EventCategory | *(drop)* | — | Redundant; SubmissionType is sufficient |
| Timestamp | SubmittedAt | DATETIME | Clearer semantics; aligns with ApprovedAt, ExpirationTime |
| ExpiresAt | ExpirationTime | DATETIME | Explicit "time of expiration" not "expires at moment X" |
| ApprovalDate | ApprovedAt | DATETIME | Consistent naming pattern (SubmittedAt, ApprovedAt) |
| ScreenshotFileId | ScreenshotId | VARCHAR(255) | Shorter, still clear |
| OCRTimestamp | OCRProcessedAt | DATETIME | Clearer: "time of OCR processing" |
| — | — | — | Keep all others as-is (MemberID, Email, Amount, Status, etc.) |

### New Column Ordering (post-migration)
```sql
ALTER TABLE submissions
  CHANGE COLUMN Timestamp SubmittedAt DATETIME NOT NULL,
  CHANGE COLUMN ExpiresAt ExpirationTime DATETIME DEFAULT NULL,
  CHANGE COLUMN ApprovalDate ApprovedAt DATETIME DEFAULT NULL,
  CHANGE COLUMN ScreenshotFileId ScreenshotId VARCHAR(255) DEFAULT NULL,
  CHANGE COLUMN OCRTimestamp OCRProcessedAt DATETIME DEFAULT NULL,
  DROP COLUMN EventCategory;

-- Update primary key index name
ALTER TABLE submissions
  DROP PRIMARY KEY,
  ADD PRIMARY KEY (SubmissionID);

-- Update foreign key in other references
-- (if any other table references webapp_events, update those too)
```

### Impact Analysis
- **UI:** Update References in payments.js (SubmittedAt instead of Timestamp)
- **Sync:** No change needed (columns are synced as-is to Google Sheets)
- **Triggers:** Reference the table by new name `submissions`
- **Backwards compat:** Keep as NULL-friendly defaults on existing columns

---

## Q4: How to Dump Existing Triggers

To see current triggers on Azure MySQL:

```bash
# SSH into Azure Cloud Shell or local MySQL client
mysql-mmr -e "SHOW TRIGGERS;" | head -20

# Get full CREATE TRIGGER statement
mysql-mmr -e "SHOW CREATE TRIGGER trg_existing_name;"

# Dump all triggers to file
mysqldump -h [host] -u [user] -p \
  --triggers --no-create-info --no-data --no-create-db \
  mmrdb > triggers_backup.sql
```

Since your schema_snapshot.sql only has CREATE TABLE statements, add triggers to a separate file:
- `db/schema_triggers.sql` — All trigger definitions (source of truth)
- `db/schema_migrations/` — One file per migration (e.g., MIGRATION_V11_TRIGGERS.sql)

---

## Implementation Checklist

- [ ] **Backup:** Export current schema + triggers to `db/backup_pre_v11/`
- [ ] **Test on staging:** Rename webapp_events → submissions
- [ ] **Test triggers:** Create three triggers on staging; insert test payments
- [ ] **Create view:** v_payment_audit for audit/reporting
- [ ] **Update code references:** payments.js (SubmittedAt), trigger references
- [ ] **Update schema_snapshot.sql** with new table name + columns
- [ ] **Create db/schema_triggers.sql** with all three triggers (source of truth)
- [ ] **Deploy to production:** Run migration (no data loss; just renames)
- [ ] **Verify:** Check that payments auto-update members; gmail_transactions are linked

---

## Token Efficiency Summary

This design:
1. **Eliminates bidirectional sync complexity** (removes ~800 lines of Python)
2. **Uses database semantics** (triggers vs app logic) → transparent, auditable
3. **Improves naming clarity** (submissions vs webapp_events)
4. **Provides both audit trails** (raw updates + view joins)
5. **Scales naturally** (no app polling needed)

**Cost to implement:** ~1000 tokens (SQL migration + code updates + testing)
