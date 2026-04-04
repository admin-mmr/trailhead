-- ============================================================================
-- SCHEMA IMPROVEMENTS & HARDENING
-- ============================================================================
--
-- This migration improves schema robustness by:
--   1. Adding DEFAULT values to DATETIME columns without defaults
--   2. Adding NOT NULL constraints to critical columns
--   3. Creating verbose error-tracking tables
--   4. Adding CHECK constraints for ENUM validation
--   5. Improving indexing for JOIN performance
--   6. Adding data validation triggers with error logging
--
-- Run sections individually (MySQL 5.7+ compatibility)
-- Each statement should be executed separately due to MySQL 5.7 limitations
--
-- ============================================================================


-- ============================================================================
-- SECTION 1: ADD VERBOSE ERROR LOGGING TABLE
-- ============================================================================
-- Captures all schema validation errors with full context

CREATE TABLE IF NOT EXISTS `schema_error_log` (
  `ErrorLogID` varchar(50) NOT NULL,
  `TableName` varchar(100) NOT NULL,
  `ColumnName` varchar(100),
  `ErrorType` enum(
    'NULL_VIOLATION',
    'FOREIGN_KEY_VIOLATION',
    'ENUM_VIOLATION',
    'DUPLICATE_UNIQUE',
    'DATA_TYPE_MISMATCH',
    'CONSTRAINT_VIOLATION'
  ) NOT NULL,
  `ErrorMessage` text NOT NULL,
  `ProblematicValue` text,
  `OffendingRowID` varchar(255),
  `DetectedAt` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `ResolvedAt` datetime,
  `ResolvedBy` varchar(100),
  `ResolutionNotes` text,
  `Status` enum('open', 'in_progress', 'resolved', 'ignored') DEFAULT 'open',
  PRIMARY KEY (`ErrorLogID`),
  INDEX idx_table_error_type (`TableName`, `ErrorType`),
  INDEX idx_detected_at (`DetectedAt`),
  INDEX idx_status (`Status`)
);

-- ============================================================================
-- SECTION 2: FIX DATETIME COLUMNS WITHOUT DEFAULT
-- ============================================================================
-- These columns would cause INSERT failures on NULL

-- Fix submissions table
ALTER TABLE `submissions`
MODIFY `CreatedAt` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT 'Timestamp when user submits';

ALTER TABLE `submissions`
MODIFY `UpdatedAt` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT 'Auto-updated on any change';

-- Fix members table
ALTER TABLE `members`
MODIFY `CreatedAt` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT 'Account creation time';

ALTER TABLE `members`
MODIFY `UpdatedAt` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT 'Last profile update';

-- Fix admin_member_overrides table
ALTER TABLE `admin_member_overrides`
MODIFY `CreatedAt` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT 'Override creation time';

ALTER TABLE `admin_member_overrides`
MODIFY `UpdatedAt` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT 'Override last change';

-- Fix member_log table
ALTER TABLE `member_log`
MODIFY `CreatedAt` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT 'Event timestamp';

ALTER TABLE `member_log`
MODIFY `UpdatedAt` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT 'Log entry update time';

-- Fix payments table
ALTER TABLE `payments`
MODIFY `CreatedAt` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT 'Payment record creation';

ALTER TABLE `payments`
MODIFY `UpdatedAt` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT 'Payment status change';

-- Fix gmail_transactions table
ALTER TABLE `gmail_transactions`
MODIFY `ImportedAt` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT 'Gmail sync timestamp';

ALTER TABLE `gmail_transactions`
MODIFY `UpdatedAt` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT 'Last transaction update';


-- ============================================================================
-- SECTION 3: ADD CHECK CONSTRAINTS FOR ENUM VALIDATION
-- ============================================================================
-- Ensures only valid enum values are inserted

-- Submissions Status validation
ALTER TABLE `submissions`
ADD CONSTRAINT chk_submissions_status CHECK (
  `Status` IN ('pending', 'approved', 'cancelled', 'expired')
);

-- Members Status validation
ALTER TABLE `members`
ADD CONSTRAINT chk_members_status CHECK (
  `Status` IN ('active', 'inactive', 'suspended', 'deceased')
);

-- Members Type validation
ALTER TABLE `members`
ADD CONSTRAINT chk_members_type CHECK (
  `Type` IN ('standard', 'lifetime', 'honorary')
);

-- AdminMemberOverrides ActionType validation
ALTER TABLE `admin_member_overrides`
ADD CONSTRAINT chk_override_action_type CHECK (
  `ActionType` IN ('APPROVE_SUBMISSION', 'REJECT_SUBMISSION', 'REFUND_PAYMENT', 'DELETE_RECORD', 'FORCE_STATUS')
);

-- MemberLog Status validation
ALTER TABLE `member_log`
ADD CONSTRAINT chk_member_log_status CHECK (
  `Status` IN ('active', 'inactive', 'suspended', 'deceased')
);


-- ============================================================================
-- SECTION 4: ADD INDICES FOR FOREIGN KEY PERFORMANCE
-- ============================================================================
-- Improves JOIN query performance and validates references

-- submissions table indices
ALTER TABLE `submissions` ADD INDEX idx_member_id (`MemberID`);
ALTER TABLE `submissions` ADD INDEX idx_status (`Status`);
ALTER TABLE `submissions` ADD INDEX idx_payment_id (`PaymentID`);

-- members table indices
ALTER TABLE `members` ADD INDEX idx_status (`Status`);
ALTER TABLE `members` ADD INDEX idx_email (`Email`);

-- admin_member_overrides indices
ALTER TABLE `admin_member_overrides` ADD INDEX idx_member_id (`MemberID`);
ALTER TABLE `admin_member_overrides` ADD INDEX idx_submission_id (`SubmissionID`);

-- member_log indices
ALTER TABLE `member_log` ADD INDEX idx_member_id (`MemberID`);
ALTER TABLE `member_log` ADD INDEX idx_status (`Status`);

-- payments indices
ALTER TABLE `payments` ADD INDEX idx_submission_id (`SubmissionID`);
ALTER TABLE `payments` ADD INDEX idx_member_id (`MemberID`);

-- gmail_transactions indices
ALTER TABLE `gmail_transactions` ADD INDEX idx_subject (`Subject`(100));
ALTER TABLE `gmail_transactions` ADD INDEX idx_imported_at (`ImportedAt`);


-- ============================================================================
-- SECTION 5: VALIDATION TRIGGER FOR NULL VIOLATIONS
-- ============================================================================
-- Automatically logs constraint violations before INSERT/UPDATE

DELIMITER $$

CREATE TRIGGER trg_submissions_null_check
BEFORE INSERT ON `submissions`
FOR EACH ROW
BEGIN
  IF NEW.`SubmissionID` IS NULL THEN
    INSERT INTO `schema_error_log` (
      `ErrorLogID`, `TableName`, `ColumnName`, `ErrorType`, `ErrorMessage`,
      `ProblematicValue`, `OffendingRowID`, `Status`
    ) VALUES (
      UUID(), 'submissions', 'SubmissionID', 'NULL_VIOLATION',
      'SubmissionID cannot be NULL — required for PRIMARY KEY',
      NULL, NULL, 'open'
    );
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'NULL violation: SubmissionID cannot be NULL';
  END IF;
END$$

DELIMITER ;

DELIMITER $$

CREATE TRIGGER trg_members_null_check
BEFORE INSERT ON `members`
FOR EACH ROW
BEGIN
  IF NEW.`MemberID` IS NULL THEN
    INSERT INTO `schema_error_log` (
      `ErrorLogID`, `TableName`, `ColumnName`, `ErrorType`, `ErrorMessage`,
      `ProblematicValue`, `OffendingRowID`, `Status`
    ) VALUES (
      UUID(), 'members', 'MemberID', 'NULL_VIOLATION',
      'MemberID cannot be NULL — required for PRIMARY KEY',
      NULL, NULL, 'open'
    );
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'NULL violation: MemberID cannot be NULL';
  END IF;

  IF NEW.`Email` IS NULL THEN
    INSERT INTO `schema_error_log` (
      `ErrorLogID`, `TableName`, `ColumnName`, `ErrorType`, `ErrorMessage`,
      `ProblematicValue`, `OffendingRowID`, `Status`
    ) VALUES (
      UUID(), 'members', 'Email', 'NULL_VIOLATION',
      'Email cannot be NULL — required for member identification',
      NULL, NULL, 'open'
    );
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'NULL violation: Email cannot be NULL';
  END IF;
END$$

DELIMITER ;


-- ============================================================================
-- SECTION 6: STORED PROCEDURE TO SCAN FOR EXISTING VIOLATIONS
-- ============================================================================
-- Run this after applying constraints to find and log existing violations

DELIMITER $$

CREATE PROCEDURE sp_scan_schema_violations()
BEGIN
  DECLARE v_orphan_count INT;
  DECLARE v_null_count INT;

  -- Clear previous scan results
  DELETE FROM `schema_error_log` WHERE `Status` = 'open' AND `DetectedAt` < NOW() - INTERVAL 1 DAY;

  -- Check submissions.PaymentID references
  SELECT COUNT(*) INTO v_orphan_count
  FROM `submissions` s
  WHERE s.`PaymentID` IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM `payments` p WHERE p.`PaymentID` = s.`PaymentID`);

  IF v_orphan_count > 0 THEN
    INSERT INTO `schema_error_log` (
      `ErrorLogID`, `TableName`, `ColumnName`, `ErrorType`, `ErrorMessage`,
      `OffendingRowID`, `Status`
    ) VALUES (
      UUID(), 'submissions', 'PaymentID', 'FOREIGN_KEY_VIOLATION',
      CONCAT(v_orphan_count, ' records reference non-existent payments'),
      NULL, 'open'
    );
  END IF;

  -- Check members with NULL Email
  SELECT COUNT(*) INTO v_null_count
  FROM `members`
  WHERE `Email` IS NULL;

  IF v_null_count > 0 THEN
    INSERT INTO `schema_error_log` (
      `ErrorLogID`, `TableName`, `ColumnName`, `ErrorType`, `ErrorMessage`,
      `OffendingRowID`, `Status`
    ) VALUES (
      UUID(), 'members', 'Email', 'NULL_VIOLATION',
      CONCAT(v_null_count, ' members have NULL Email'),
      NULL, 'open'
    );
  END IF;

  SELECT COUNT(*) FROM `schema_error_log` WHERE `Status` = 'open' AS error_count;
END$$

DELIMITER ;


-- ============================================================================
-- SECTION 7: REPAIR SCRIPT FOR KNOWN ISSUES
-- ============================================================================
-- Use this to fix specific data quality issues

-- Fix NULL SubmissionIDs (if any exist)
-- UPDATE `submissions`
-- SET `SubmissionID` = UUID()
-- WHERE `SubmissionID` IS NULL;

-- Fix submissions with invalid Status values
-- UPDATE `submissions`
-- SET `Status` = 'pending'
-- WHERE `Status` NOT IN ('pending', 'approved', 'cancelled', 'expired');

-- Fix members with invalid Status values
-- UPDATE `members`
-- SET `Status` = 'active'
-- WHERE `Status` NOT IN ('active', 'inactive', 'suspended', 'deceased');

-- Fix submissions.PaymentID pointing to non-existent payments
-- UPDATE `submissions`
-- SET `PaymentID` = NULL
-- WHERE `PaymentID` IS NOT NULL
--   AND NOT EXISTS (
--     SELECT 1 FROM `payments` p WHERE p.`PaymentID` = `submissions`.`PaymentID`
--   );


-- ============================================================================
-- SECTION 8: MONITORING QUERIES
-- ============================================================================
-- Use these to monitor data quality after applying improvements

-- View all open schema errors
-- SELECT * FROM `schema_error_log` WHERE `Status` = 'open' ORDER BY `DetectedAt` DESC;

-- Count errors by type
-- SELECT `ErrorType`, COUNT(*) as error_count
-- FROM `schema_error_log`
-- WHERE `Status` IN ('open', 'in_progress')
-- GROUP BY `ErrorType`;

-- Find orphaned submissions
-- SELECT s.*, p.PaymentID
-- FROM `submissions` s
-- LEFT JOIN `payments` p ON s.`PaymentID` = p.`PaymentID`
-- WHERE s.`PaymentID` IS NOT NULL AND p.`PaymentID` IS NULL;

-- Find members with invalid enum values
-- SELECT * FROM `members`
-- WHERE `Status` NOT IN ('active', 'inactive', 'suspended', 'deceased')
--    OR `Type` NOT IN ('standard', 'lifetime', 'honorary');
