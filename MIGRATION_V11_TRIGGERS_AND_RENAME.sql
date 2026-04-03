-- Migration V11: Rename webapp_events → submissions + Create Payment Automation Triggers
-- Date: 2026-04-03
-- Description: Simplify schema naming and implement trigger-based payment automation

-- ============================================================================
-- STEP 1: Check for existing triggers (informational, run separately)
-- ============================================================================

-- To see all current triggers (run via Azure Cloud Shell or mysql-mmr):
-- SHOW TRIGGERS;
-- SHOW CREATE TRIGGER [trigger_name];

-- ============================================================================
-- STEP 2: Rename webapp_events table to submissions
-- ============================================================================

-- 2a. Rename table
ALTER TABLE webapp_events RENAME TO submissions;

-- 2b. Rename columns
ALTER TABLE submissions
  CHANGE COLUMN EventID SubmissionID VARCHAR(50) NOT NULL COMMENT 'Primary key: unique submission ID',
  CHANGE COLUMN EventType SubmissionType VARCHAR(50) NOT NULL COMMENT 'Type of submission (e.g., membership_payment, donation)',
  DROP COLUMN EventCategory COMMENT 'Removed: redundant with SubmissionType',
  CHANGE COLUMN Timestamp SubmittedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT 'When user submitted the payment',
  CHANGE COLUMN ExpiresAt ExpirationTime DATETIME DEFAULT NULL COMMENT 'When this submission expires (unpaired)',
  CHANGE COLUMN ApprovalDate ApprovedAt DATETIME DEFAULT NULL COMMENT 'When admin approved this submission',
  CHANGE COLUMN ScreenshotFileId ScreenshotId VARCHAR(255) DEFAULT NULL COMMENT 'Google Drive file ID for screenshot',
  CHANGE COLUMN OCRTimestamp OCRProcessedAt DATETIME DEFAULT NULL COMMENT 'When OCR was processed';

-- 2c. Update primary key constraint name (optional but good practice)
-- Old: PRIMARY KEY (EventID)
-- New: PRIMARY KEY (SubmissionID)
-- (ALTER TABLE already handled this via CHANGE COLUMN)

-- 2d. Add migration record
INSERT INTO schema_migrations (version, description, executed_at)
VALUES ('V11_RENAME_AND_TRIGGERS', 'Rename webapp_events→submissions; add payment automation triggers', NOW());

-- ============================================================================
-- STEP 3: Create Trigger 1 — Payment → Members (Individual & Family Sync)
-- ============================================================================

DELIMITER //

CREATE TRIGGER trg_payments_after_insert_update_members
AFTER INSERT ON payments
FOR EACH ROW
BEGIN
  DECLARE family_id VARCHAR(10);

  -- Only process membership payments
  IF NEW.MembershipType LIKE '%Membership%' THEN

    -- Get the FamilyID of the member making the payment
    SELECT FamilyID INTO family_id
    FROM members
    WHERE MemberID = NEW.MemberID
    LIMIT 1;

    -- Update all family members or just the individual
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
      -- Case 1: Family member → update all in family
      (family_id IS NOT NULL AND FamilyID = family_id)
      OR
      -- Case 2: Individual member → update just that member
      (MemberID = NEW.MemberID AND family_id IS NULL);

  END IF;
END;
//

DELIMITER ;

-- ============================================================================
-- STEP 4: Create Trigger 2 — Payment → Gmail Transactions (Link Metadata)
-- ============================================================================

DELIMITER //

CREATE TRIGGER trg_payments_after_insert_update_gmail_link
AFTER INSERT ON payments
FOR EACH ROW
BEGIN
  DECLARE member_family_id VARCHAR(10);

  -- Get the member's FamilyID for context
  SELECT FamilyID INTO member_family_id
  FROM members
  WHERE MemberID = NEW.MemberID
  LIMIT 1;

  -- Link the payment to the gmail_transactions record
  UPDATE gmail_transactions
  SET
    PaymentID = NEW.PaymentID,
    ProcessedTime = NOW(),
    Notes = CONCAT(
      NEW.MembershipType,
      ' for MemberID=',
      NEW.MemberID,
      CASE
        WHEN NEW.MembershipType LIKE '%Family%' AND member_family_id IS NOT NULL
          THEN CONCAT(' (FamilyID=', member_family_id, ')')
        ELSE ''
      END
    ),
    SyncedAt = NOW()
  WHERE TransactionNumber = NEW.TransactionReference;

END;
//

DELIMITER ;

-- ============================================================================
-- STEP 5: (Optional) Create Trigger 3 — Payment Update Audit
-- ============================================================================
-- Use this if payments can be edited (e.g., amount/date corrections)
-- This ensures member expiration is re-synced if payment date changes

DELIMITER //

CREATE TRIGGER trg_payments_after_update_members
AFTER UPDATE ON payments
FOR EACH ROW
WHEN (NEW.MembershipType LIKE '%Membership%' AND NEW.PaymentDate <> OLD.PaymentDate)
BEGIN
  DECLARE member_family_id VARCHAR(10);

  -- Get the member's FamilyID
  SELECT FamilyID INTO member_family_id
  FROM members
  WHERE MemberID = NEW.MemberID
  LIMIT 1;

  -- Re-sync expiration if payment date changed
  UPDATE members
  SET
    Expiration = DATE_ADD(NEW.PaymentDate, INTERVAL 1 YEAR),
    UpdatedAt = NOW(),
    updated_at_unix = UNIX_TIMESTAMP(NOW())
  WHERE
    MemberID = NEW.MemberID
    OR (member_family_id IS NOT NULL AND FamilyID = member_family_id);

END;
//

DELIMITER ;

-- ============================================================================
-- STEP 6: Create View for Payment Audit Trail
-- ============================================================================

DROP VIEW IF EXISTS v_payment_audit;

CREATE VIEW v_payment_audit AS
SELECT
  p.PaymentID,
  p.MemberID,
  m.FirstName,
  m.LastName,
  m.FamilyID,
  m.Type AS MemberType,
  p.Amount,
  p.PaymentDate,
  p.MembershipType,
  p.TransactionReference,
  gt.MessageId AS GmailMessageId,
  gt.Sender AS GmailSender,
  gt.Amount AS GmailAmount,
  gt.TransactionDate AS GmailDate,
  gt.ProcessedTime AS LinkedAt,
  CASE
    WHEN gt.PaymentID IS NOT NULL THEN 'linked'
    ELSE 'unlinked'
  END AS LinkStatus,
  gt.Notes AS LinkNotes,
  p.CreatedAt AS PaymentCreatedAt,
  p.ProcessedDate AS PaymentProcessedDate
FROM payments p
LEFT JOIN gmail_transactions gt
  ON p.TransactionReference = gt.TransactionNumber
LEFT JOIN members m
  ON p.MemberID = m.MemberID
ORDER BY p.PaymentDate DESC, p.CreatedAt DESC;

-- ============================================================================
-- STEP 7: Verify Migration
-- ============================================================================

-- After running above, verify:
-- 1. Check that submissions table exists with new columns:
--    SELECT COLUMN_NAME, DATA_TYPE FROM INFORMATION_SCHEMA.COLUMNS
--    WHERE TABLE_NAME='submissions' AND TABLE_SCHEMA='mmrdb';

-- 2. Check triggers were created:
--    SHOW TRIGGERS;

-- 3. Test with sample data:
--    INSERT INTO payments (PaymentID, MemberID, PaymentDate, Amount, MembershipType, TransactionReference, Source, CreatedAt)
--    VALUES ('TEST001', 'M001', '2026-04-03', 100.00, 'Individual Membership', 'TXN-TEST-001', 'manual', NOW());
--
--    -- Verify members table was updated:
--    SELECT MemberID, PaymentDate, MembershipFeePaid, Expiration, Status FROM members WHERE MemberID='M001';
--
--    -- Verify gmail_transactions was linked (if matching TransactionNumber exists):
--    SELECT PaymentID, ProcessedTime, Notes FROM gmail_transactions WHERE TransactionNumber='TXN-TEST-001';

-- 4. Test Family scenario:
--    -- Insert 2 members with same FamilyID
--    -- Insert payment for one of them
--    -- Verify both got updated

-- ============================================================================
-- STEP 8: Update schema_snapshot.sql
-- ============================================================================
-- After running this migration, regenerate schema snapshot:
-- 1. Run: mysqldump --no-data --triggers -h [host] -u [user] -p mmrdb > db/schema_snapshot.sql
-- 2. Verify submissions table is present with new columns
-- 3. Verify three triggers are in the dump
-- 4. Commit: git add db/schema_snapshot.sql && git commit -m "chore: update schema snapshot post-V11 migration"

-- ============================================================================
-- ROLLBACK (if needed)
-- ============================================================================
--
-- DROP TRIGGER IF EXISTS trg_payments_after_insert_update_members;
-- DROP TRIGGER IF EXISTS trg_payments_after_insert_update_gmail_link;
-- DROP TRIGGER IF EXISTS trg_payments_after_update_members;
-- DROP VIEW IF EXISTS v_payment_audit;
-- ALTER TABLE submissions RENAME TO webapp_events;
-- ALTER TABLE webapp_events
--   CHANGE COLUMN SubmissionID EventID VARCHAR(50) NOT NULL,
--   CHANGE COLUMN SubmissionType EventType VARCHAR(50) NOT NULL,
--   ADD COLUMN EventCategory VARCHAR(50) DEFAULT 'payment',
--   CHANGE COLUMN SubmittedAt Timestamp DATETIME NOT NULL,
--   CHANGE COLUMN ExpirationTime ExpiresAt DATETIME DEFAULT NULL,
--   CHANGE COLUMN ApprovedAt ApprovalDate DATETIME DEFAULT NULL,
--   CHANGE COLUMN ScreenshotId ScreenshotFileId VARCHAR(255) DEFAULT NULL,
--   CHANGE COLUMN OCRProcessedAt OCRTimestamp DATETIME DEFAULT NULL;
--
