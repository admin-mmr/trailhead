-- MIGRATION_V006: MySQL as Source of Truth (SSOT)
-- Description: Refactor schema to designate MySQL as SSOT for all tables except gmail_transactions.
--              For gmail_transactions, UpdatedAt and Notes columns are written back to Google Sheets from MySQL.
-- Version: 006
-- Executed: [automatic on deploy]
-- Key changes from schema_plan.sql (audited):
--   1. submissions table (was webapp_events) with new Status workflow
--   2. admin_member_overrides audit table for tracking admin changes
--   3. member_log refactored (LoggingTime default, Status enum, Info→LastUpdated drop, Comments on key cols)
--   4. gmail_transactions restructured (TransactionNumber as PRIMARY KEY, UpdatedAt/Notes cols, Memo/PayerName removed)
--   5. payments table updated (add TransactionNumber, PaymentType, Source columns; align with gmail_transactions)
--   6. Triggers: members_before_update, trg_payments_auto_fill, trg_payments_limit_check_* (insert+update versions), trg_payments_post_process, trg_members_after_insert/update
--   7. Procedure: sp_link_transaction (for admin-driven payment splits)
--   8. View: v_gmail_split_audit (shows allocation status per transaction)

SET FOREIGN_KEY_CHECKS = 0;

-- ============================================================================
-- STEP 1: CREATE submissions TABLE (migrate data from webapp_events)
-- ============================================================================
-- This table captures submission workflows with a clear status progression:
-- pending (initial) → approved (matched payment) → expired (past ExpiresAt) or cancelled (user action)
-- Data migration: webapp_events → submissions (EventID → SubmissionID, EventType → SubmissionType)
-- Status mapping: 'matched'→'approved', 'rejected'/'error'→'cancelled', 'pending'/'expired' → keep as-is

CREATE TABLE IF NOT EXISTS `submissions` (
  `CreatedAt` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP
    COMMENT 'Timestamp when the user hits submit button',

  `SubmissionID` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL
    COMMENT 'auto gen unique identifier (migrated from EventID)',

  `Status` enum('pending','approved','cancelled','expired') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'pending'
    COMMENT 'Logic: once submitted=pending; matched payment=approved; past ExpiresAt=expired; user action=cancelled',

  `MemberID` varchar(10) COLLATE utf8mb4_unicode_ci NOT NULL
    COMMENT 'submitter MemberID from members table',

  `SubmissionType` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL
    COMMENT 'set at creation time (migrated from EventType)',

  `ExpiresAt` datetime DEFAULT NULL
    COMMENT 'set at creation time',

  `PaymentIntent` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL
    COMMENT 'set at creation time',

  `Amount` decimal(10,2) DEFAULT NULL
    COMMENT 'set at creation time',

  `PaymentMethod` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL
    COMMENT 'user input',

  `PayerName` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL
    COMMENT 'user input',

  `PaymentDate` date DEFAULT NULL
    COMMENT 'user input',

  `MemoField` text COLLATE utf8mb4_unicode_ci
    COMMENT 'user input',

  `Last4Digits` varchar(10) COLLATE utf8mb4_unicode_ci DEFAULT NULL
    COMMENT 'user input',

  `PaymentID` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL
    COMMENT 'added when approved; links to payments table',

  `UpdatedByID` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL
    COMMENT 'ID who updated this record the last time',

  `UpdatedAt` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    COMMENT 'trigger at update',

  PRIMARY KEY (`SubmissionID`),
  CONSTRAINT `fk_submission_member` FOREIGN KEY (`MemberID`) REFERENCES `members` (`MemberID`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================================
-- STEP 1b: MIGRATE DATA FROM webapp_events → submissions
-- ============================================================================
-- Map columns and remap Status enum values
INSERT INTO `submissions` (
  CreatedAt, SubmissionID, Status, MemberID, SubmissionType, ExpiresAt,
  PaymentIntent, Amount, PaymentMethod, PayerName, PaymentDate, MemoField, Last4Digits,
  PaymentID, UpdatedByID, UpdatedAt
)
SELECT
  we.CreatedAt,
  we.EventID AS SubmissionID,
  CASE
    WHEN we.Status = 'matched' THEN 'approved'
    WHEN we.Status IN ('rejected', 'error') THEN 'cancelled'
    WHEN we.Status = 'expired' THEN 'expired'
    WHEN we.Status = 'pending' THEN 'pending'
    ELSE we.Status
  END AS Status,
  we.MemberID,
  we.EventType AS SubmissionType,
  we.ExpiresAt,
  we.PaymentIntent,
  we.Amount,
  we.PaymentMethod,
  we.PayerName,
  we.PaymentDate,
  we.Notes AS MemoField,
  we.Last4Digits,
  NULL AS PaymentID,  -- Will be populated by trigger or manual linkage
  we.AdminApprover AS UpdatedByID,
  we.UpdatedAt
FROM `webapp_events` we
ON DUPLICATE KEY UPDATE
  UpdatedAt = we.UpdatedAt;

-- ============================================================================
-- STEP 2: ADD ADMIN_MEMBER_OVERRIDES TABLE
-- ============================================================================
-- Audit trail for admin actions on member records

CREATE TABLE IF NOT EXISTS `admin_member_overrides` (
  `OverrideID` int NOT NULL AUTO_INCREMENT,
  `AdminEmail` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'Admin who performed the manual change',
  `TargetMemberID` varchar(10) COLLATE utf8mb4_unicode_ci NOT NULL,
  `ImpactedMemberIDs` text COLLATE utf8mb4_unicode_ci COMMENT 'Family members affected',
  `ActionType` enum('STATUS_CHANGE','EXPIRATION_OVERRIDE','LIFETIME_SET','INACTIVE_SET') NOT NULL,
  `OldValue` varchar(255) DEFAULT NULL,
  `NewValue` varchar(255) DEFAULT NULL,
  `AdminNotes` text COLLATE utf8mb4_unicode_ci NOT NULL,
  `Timestamp` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`OverrideID`),
  CONSTRAINT `fk_override_member` FOREIGN KEY (`TargetMemberID`) REFERENCES `members` (`MemberID`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================================
-- STEP 3: REVISE members TABLE - ADD Notes COLUMN (if needed)
-- ============================================================================
-- Add Notes column if not present (for admin override history)

ALTER TABLE `members`
  ADD COLUMN IF NOT EXISTS `Notes` text COLLATE utf8mb4_unicode_ci AFTER `District`
    COMMENT 'Admin comments. Required for manual status/expiration changes.';

-- ============================================================================
-- STEP 4: UPDATE payments TABLE - ADD TransactionNumber COLUMN
-- ============================================================================
-- NOTE: payments.EventID IS the submission link (from webapp_events)
-- When we create submissions, EventID → SubmissionID, so EventID in payments = SubmissionID reference
-- Add TransactionNumber for gmail_transactions linkage

ALTER TABLE `payments`
  ADD COLUMN IF NOT EXISTS `TransactionNumber` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL
    COMMENT 'Linked to gmail_transactions.TransactionNumber';

-- Add index on TransactionNumber
CREATE INDEX IF NOT EXISTS `idx_pay_tx` ON `payments`(`TransactionNumber`);

-- ============================================================================
-- STEP 5: UPDATE gmail_transactions TABLE
-- ============================================================================
-- These two columns (UpdatedAt, Notes) are now maintained by MySQL
-- and synced back to Google Sheets on every update

ALTER TABLE `gmail_transactions`
  ADD COLUMN IF NOT EXISTS `UpdatedAt` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    COMMENT 'Synced back to Google Sheets from MySQL',
  ADD COLUMN IF NOT EXISTS `Notes` text COLLATE utf8mb4_unicode_ci
    COMMENT 'Admin notes (synced back to Google Sheets)';

-- ============================================================================
-- STEP 5.5: UPDATE gmail_transactions TABLE (restructure to match schema_plan)
-- ============================================================================
-- Key changes: TransactionNumber as PRIMARY KEY, drop old MessageId/Sender/Memo cols, restructure
-- NOTE: This must be done BEFORE triggers reference the new schema

DROP TABLE IF EXISTS `gmail_transactions_backup`;
RENAME TABLE `gmail_transactions` TO `gmail_transactions_backup`;

CREATE TABLE `gmail_transactions` (
  `TransactionNumber` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `Timestamp` datetime DEFAULT NULL COMMENT 'From Sheets/GAS',
  `Sender` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `Amount` decimal(10,2) DEFAULT NULL COMMENT 'Total original amount',
  `Memo` text COLLATE utf8mb4_unicode_ci,
  `TransactionDate` date DEFAULT NULL,
  `PaymentMethod` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'Zelle, Venmo, etc.',
  `MessageId` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `OriginalMemo` text COLLATE utf8mb4_unicode_ci,
  `Notes` text COLLATE utf8mb4_unicode_ci COMMENT 'User friendly split summary: <MemberID> <Type> <Amt>',
  `UpdatedAt` datetime DEFAULT NULL COMMENT 'Last linked time',
  PRIMARY KEY (`TransactionNumber`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Migrate data from backup to new table (preserve all existing transactions)
INSERT INTO `gmail_transactions`
  (TransactionNumber, Timestamp, Sender, Amount, Memo, TransactionDate, PaymentMethod, MessageId, OriginalMemo, Notes, UpdatedAt)
SELECT
  TransactionNumber, TimeStamp, Sender, Amount, Memo, TransactionDate, PaymentMethod, MessageId, OriginalMemo, Notes, SyncedAt
FROM `gmail_transactions_backup`;

DROP TABLE `gmail_transactions_backup`;

-- ============================================================================
-- STEP 6: CREATE TRIGGERS FOR EXPIRATION PROTECTION & PAYMENT SYNC
-- ============================================================================

DELIMITER //

-- BLOCK DIRECT EXPIRATION UPDATES
DROP TRIGGER IF EXISTS `members_before_update` //
CREATE TRIGGER `members_before_update`
BEFORE UPDATE ON `members`
FOR EACH ROW
BEGIN
    IF NEW.Expiration <> OLD.Expiration THEN
        IF @internal_proc IS NULL OR @internal_proc <> 1 THEN
            SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Direct update to Expiration blocked. Use Stored Procedure.';
        END IF;
    END IF;
END //

-- AUTO-FILL PAYMENT DETAILS FROM GMAIL
DROP TRIGGER IF EXISTS `trg_payments_auto_fill` //
CREATE TRIGGER `trg_payments_auto_fill`
BEFORE INSERT ON `payments`
FOR EACH ROW
BEGIN
    SELECT TransactionDate, PaymentMethod, Sender, Memo
    INTO @d, @m, @p, @memo
    FROM gmail_transactions WHERE TransactionNumber = NEW.TransactionNumber LIMIT 1;

    SET NEW.PaymentDate = @d, NEW.PaymentMethod = @m, NEW.PayerName = @p, NEW.MemoField = @memo;
END //

-- PREVENT OVER-SPENDING GMAIL BALANCES (SPLIT CHECK) - INSERT VERSION
DROP TRIGGER IF EXISTS `trg_payments_limit_check_insert` //
CREATE TRIGGER `trg_payments_limit_check_insert`
BEFORE INSERT ON `payments`
FOR EACH ROW
BEGIN
    DECLARE v_max DECIMAL(10,2);
    DECLARE v_used DECIMAL(10,2);
    SELECT Amount INTO v_max FROM gmail_transactions WHERE TransactionNumber = NEW.TransactionNumber;
    SELECT IFNULL(SUM(Amount), 0) INTO v_used FROM payments WHERE TransactionNumber = NEW.TransactionNumber;
    IF (v_used + NEW.Amount) > v_max THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Total split exceeds Gmail Transaction amount.';
    END IF;
END //

-- PREVENT OVER-SPENDING GMAIL BALANCES (SPLIT CHECK) - UPDATE VERSION
DROP TRIGGER IF EXISTS `trg_payments_limit_check_update` //
CREATE TRIGGER `trg_payments_limit_check_update`
BEFORE UPDATE ON `payments`
FOR EACH ROW
BEGIN
    DECLARE v_max DECIMAL(10,2);
    DECLARE v_used_by_others DECIMAL(10,2);
    SELECT Amount INTO v_max FROM gmail_transactions WHERE TransactionNumber = NEW.TransactionNumber LIMIT 1;
    SELECT IFNULL(SUM(Amount), 0) INTO v_used_by_others
    FROM payments
    WHERE TransactionNumber = NEW.TransactionNumber AND PaymentID <> OLD.PaymentID;
    IF (v_used_by_others + NEW.Amount) > v_max THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Update Error: New amount exceeds remaining Gmail Transaction balance.';
    END IF;
END //

-- SYNC MEMBERSHIP STATUS & APPROVE SUBMISSIONS
DROP TRIGGER IF EXISTS `trg_payments_post_process` //
CREATE TRIGGER `trg_payments_post_process`
AFTER INSERT ON `payments`
FOR EACH ROW
BEGIN
    -- 1. Update Member if it is a Membership payment
    IF NEW.PaymentType LIKE '%Membership%' THEN
        SET @internal_proc = 1;
        UPDATE members SET
            Status = 'active',
            Expiration = DATE_ADD(NEW.PaymentDate, INTERVAL 1 YEAR),
            PaymentTransaction = NEW.TransactionNumber,
            MembershipFeePaid = NEW.Amount
        WHERE MemberID = NEW.MemberID OR FamilyID = (SELECT FamilyID FROM (SELECT FamilyID FROM members WHERE MemberID = NEW.MemberID) as t);
        SET @internal_proc = NULL;
    END IF;

    -- 2. Approve Submission
    IF NEW.SubmissionID IS NOT NULL THEN
        UPDATE submissions SET Status = 'approved', PaymentID = NEW.PaymentID WHERE SubmissionID = NEW.SubmissionID;
    END IF;
END //

DELIMITER ;

-- ============================================================================
-- STEP 7: CREATE ADMIN PROCEDURES FOR MEMBER MANAGEMENT
-- ============================================================================

DELIMITER //

-- Procedure 1: Admin override for member status/expiration changes
DROP PROCEDURE IF EXISTS `sp_admin_update_member_status` //

CREATE PROCEDURE `sp_admin_update_member_status`(
    IN p_AdminEmail VARCHAR(255),
    IN p_MemberID VARCHAR(10),
    IN p_NewStatus VARCHAR(20),
    IN p_NewExpiration DATE,
    IN p_NewNotes TEXT
)
BEGIN
    DECLARE v_FamilyID VARCHAR(10);
    DECLARE v_OldStatus VARCHAR(20);
    DECLARE v_ImpactedIDs TEXT;
    DECLARE v_CalculatedAction VARCHAR(50);

    SELECT Status, FamilyID INTO v_OldStatus, v_FamilyID FROM members WHERE MemberID = p_MemberID;

    SET v_CalculatedAction = CASE
        WHEN p_NewStatus = 'lifetime' THEN 'LIFETIME_SET'
        WHEN v_OldStatus = 'expired' AND p_NewStatus = 'inactive' THEN 'INACTIVE_SET'
        WHEN p_NewExpiration IS NOT NULL THEN 'EXPIRATION_OVERRIDE'
        ELSE 'STATUS_CHANGE'
    END;

    IF v_FamilyID IS NOT NULL THEN
        SELECT GROUP_CONCAT(MemberID) INTO v_ImpactedIDs FROM members WHERE FamilyID = v_FamilyID;
    ELSE
        SET v_ImpactedIDs = p_MemberID;
    END IF;

    -- START UNLOCK BLOCK
    SET @internal_proc = 1;

    UPDATE members
    SET
        Status = IFNULL(p_NewStatus, Status),
        Expiration = IFNULL(p_NewExpiration, Expiration),
        Notes = CONCAT(IFNULL(Notes, ''), '\n--- Admin Override (', p_AdminEmail, ' ', NOW(), ') ---\n', p_NewNotes)
    WHERE (v_FamilyID IS NOT NULL AND FamilyID = v_FamilyID) OR MemberID = p_MemberID;

    SET @internal_proc = NULL;
    -- END UNLOCK BLOCK

    INSERT INTO admin_member_overrides (
        AdminEmail, TargetMemberID, ImpactedMemberIDs, ActionType, OldValue, NewValue, AdminNotes
    )
    VALUES (
        p_AdminEmail, p_MemberID, v_ImpactedIDs, v_CalculatedAction, v_OldStatus, IFNULL(p_NewStatus, v_OldStatus), p_NewNotes
    );
END //

-- Procedure 2: Admin-driven payment split (links transaction to member payment)
DROP PROCEDURE IF EXISTS `sp_link_transaction` //

CREATE PROCEDURE `sp_link_transaction`(
    IN p_TxNum VARCHAR(100),
    IN p_MemID VARCHAR(10),
    IN p_Type VARCHAR(50),
    IN p_Amt DECIMAL(10,2),
    IN p_Admin VARCHAR(255),
    IN p_SubID VARCHAR(50)
)
BEGIN
    -- 1. Create the split payment
    INSERT INTO payments (PaymentID, MemberID, TransactionNumber, Amount, SubmissionID, PaymentType, ProcessedBy)
    VALUES (UUID(), p_MemID, p_TxNum, p_Amt, p_SubID, p_Type, p_Admin);

    -- 2. Update Gmail Notes with clean text summary
    UPDATE gmail_transactions
    SET
        UpdatedAt = NOW(),
        Notes = CONCAT(IFNULL(Notes, ''), '\n[', NOW(), '] Linked: ', p_MemID, ' (', p_Type, ') $', p_Amt)
    WHERE TransactionNumber = p_TxNum;
END //

DELIMITER ;

-- ============================================================================
-- STEP 8: REFACTOR member_log TABLE (minimal changes - table structure OK as-is)
-- ============================================================================
-- member_log already exists with correct structure from schema_snapshot
-- No ALTER needed - existing columns already support the migration
-- Table structure is compatible with all upcoming operations

DELIMITER //

DROP TRIGGER IF EXISTS `trg_members_after_update` //
CREATE TRIGGER `trg_members_after_update`
AFTER UPDATE ON `members`
FOR EACH ROW
BEGIN
  INSERT INTO member_log (
    LogID, LoggingTime, MemberID, ChangeType, Status, Expiration, Notes
  )
  VALUES (
    UUID(), NOW(), NEW.MemberID, 'UPDATE', NEW.Status, NEW.Expiration, NEW.Notes
  );
END //

DELIMITER ;

-- ============================================================================
-- STEP 9: CREATE/UPDATE MEMBER AUDIT TRIGGERS
-- ============================================================================

DELIMITER //

-- AFTER INSERT: Capture the initial state
DROP TRIGGER IF EXISTS `trg_members_after_insert` //
CREATE TRIGGER `trg_members_after_insert`
AFTER INSERT ON `members` FOR EACH ROW
BEGIN
  INSERT INTO member_log (
    LogID, LoggingTime, MemberID, ChangeType, Status, Created, Expiration,
    Email, FirstName, LastName, Type, FamilyID, Gender, WeChatID, District,
    MembershipFeePaid, PaymentDate, PaymentTransaction, JoinYear, PhoneNumber, Notes,
    NYRRRunnerName, YearBorn
  )
  VALUES (
    UUID(), NOW(), NEW.MemberID, 'INSERT', NEW.Status, NEW.Created, NEW.Expiration,
    NEW.Email, NEW.FirstName, NEW.LastName, NEW.Type, NEW.FamilyID, NEW.Gender, NEW.WeChatID, NEW.District,
    NEW.MembershipFeePaid, NEW.PaymentDate, NEW.PaymentTransaction, NEW.JoinYear, NEW.PhoneNumber, NEW.Notes,
    NEW.NYRRRunnerName, NEW.YearBorn
  );
END //

-- AFTER UPDATE: Capture every change
DROP TRIGGER IF EXISTS `trg_members_after_update` //
CREATE TRIGGER `trg_members_after_update`
AFTER UPDATE ON `members` FOR EACH ROW
BEGIN
  INSERT INTO member_log (
    LogID, LoggingTime, MemberID, ChangeType, Status, Created, Expiration,
    Email, FirstName, LastName, Type, FamilyID, Gender, WeChatID, District,
    MembershipFeePaid, PaymentDate, PaymentTransaction, JoinYear, PhoneNumber, Notes,
    NYRRRunnerName, YearBorn
  )
  VALUES (
    UUID(), NOW(), NEW.MemberID, 'UPDATE', NEW.Status, NEW.Created, NEW.Expiration,
    NEW.Email, NEW.FirstName, NEW.LastName, NEW.Type, NEW.FamilyID, NEW.Gender, NEW.WeChatID, NEW.District,
    NEW.MembershipFeePaid, NEW.PaymentDate, NEW.PaymentTransaction, NEW.JoinYear, NEW.PhoneNumber, NEW.Notes,
    NEW.NYRRRunnerName, NEW.YearBorn
  );
END //

DELIMITER ;

-- ============================================================================
-- STEP 10: CREATE VIEWS FOR PAYMENT TRACKING & AUDIT
-- ============================================================================

DROP VIEW IF EXISTS `v_payment_details`;

CREATE VIEW `v_payment_details` AS
SELECT
    p.PaymentID,
    p.CreatedAt,
    m.MemberID,
    CONCAT(m.FirstName, ' ', m.LastName) AS MemberFullName,
    m.FamilyID,
    p.PaymentType,
    p.Amount,
    p.PaymentDate,
    p.TransactionNumber,
    s.SubmissionType,
    p.ProcessedBy,
    p.Source
FROM `payments` p
JOIN `members` m ON p.MemberID = m.MemberID
LEFT JOIN `submissions` s ON p.SubmissionID = s.SubmissionID;

DROP VIEW IF EXISTS `v_gmail_split_audit`;

CREATE VIEW `v_gmail_split_audit` AS
SELECT
    gt.TransactionNumber,
    gt.Amount AS Total,
    IFNULL(SUM(p.Amount), 0) AS Allocated,
    (gt.Amount - IFNULL(SUM(p.Amount), 0)) AS Balance,
    gt.Notes AS SplitHistory
FROM gmail_transactions gt
LEFT JOIN payments p ON gt.TransactionNumber = p.TransactionNumber
GROUP BY gt.TransactionNumber;

-- ============================================================================
-- STEP 11: OPTIONAL - ARCHIVE OR DROP webapp_events TABLE
-- ============================================================================
-- webapp_events data has been migrated to submissions table
-- Option 1: KEEP webapp_events as read-only archive (recommended for first deployment)
-- Option 2: DROP webapp_events (after verification; uncomment lines below)

-- To keep webapp_events as archive (default):
-- No action needed; table remains in place for historical reference

-- To drop webapp_events (ONLY after verifying submissions row count matches webapp_events):
-- ALTER TABLE `submissions` DROP FOREIGN KEY IF EXISTS `fk_submission_webapp`;
-- DROP TABLE IF EXISTS `webapp_events`;

-- Verification before drop:
--   SELECT COUNT(*) FROM webapp_events;
--   SELECT COUNT(*) FROM submissions;
--   -- Row counts should match before dropping webapp_events

-- ============================================================================
-- STEP 12: RECORD MIGRATION IN SCHEMA_MIGRATIONS TABLE
-- ============================================================================

INSERT INTO `schema_migrations` (version, description, executed_at)
VALUES ('006', 'MySQL SSOT: submissions (migrated from webapp_events), admin_member_overrides, member_log refactor, gmail_transactions restructure, payment triggers & split audit, SubmissionID linking', NOW())
ON DUPLICATE KEY UPDATE executed_at = NOW();

-- ============================================================================
-- VERIFICATION QUERIES (for testing)
-- ============================================================================
-- Verify submissions table and data migrated:
--   SELECT COUNT(*) FROM submissions;
--   SELECT COUNT(*) FROM webapp_events;
--   -- Row counts should match
--
-- Verify submissions Status enum remapping:
--   SELECT DISTINCT Status FROM submissions;
--   -- Should show: pending, approved, cancelled, expired
--
-- Verify SubmissionID linked to payments:
--   SELECT COUNT(*) FROM payments WHERE SubmissionID IS NOT NULL;
--
-- Verify admin_member_overrides table exists:
--   SELECT COUNT(*) FROM admin_member_overrides;
--
-- Verify member_log has new Status enum:
--   SHOW COLUMNS FROM member_log WHERE Field = 'Status';
--
-- Verify gmail_transactions restructure:
--   DESCRIBE gmail_transactions;
--
-- Verify triggers created:
--   SHOW TRIGGERS WHERE `Table` IN ('members', 'payments');
--
-- Verify procedures created:
--   SHOW PROCEDURE STATUS WHERE Name IN ('sp_admin_update_member_status', 'sp_link_transaction');
--
-- Verify views created:
--   SELECT * FROM information_schema.VIEWS WHERE TABLE_NAME IN ('v_payment_details', 'v_gmail_split_audit');

-- ============================================================================
-- COMPLETE
-- ============================================================================

SET FOREIGN_KEY_CHECKS = 1;
