-- ============================================================================
-- MIGRATION_V007: Improve Error Messages & Validation
-- ============================================================================
--
-- Purpose: Add detailed error messages, constraints, and validation triggers
-- to provide clear, actionable feedback when data quality issues occur.
--
-- Prerequisites:
--   - MIGRATION_V007A_fix_constraint_violations must have run first
--   - (Fixes existing data that violates new CHECK constraints)
--
-- Changes:
--   1. Enhance activity_log with structured error fields
--   2. Add CHECK constraints with descriptive names
--   3. Create error_context table for rich error tracking
--   4. Add triggers for validation with verbose messages
--   5. Improve ENUM validation with clear error messages
--
-- Date: 2026-04-04
-- Status: MySQL 5.7+ compatible (single-statement ALTERs only)
-- ============================================================================

SET FOREIGN_KEY_CHECKS = 0;


-- ============================================================================
-- SECTION 1: Enhance activity_log for better error tracking (idempotent)
-- ============================================================================

-- Only add columns if they don't exist (MySQL 5.7 compatible using INFORMATION_SCHEMA)

SET @col_exists = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'activity_log' AND COLUMN_NAME = 'ErrorContext'
);

SET @sql = IF(@col_exists = 0,
  'ALTER TABLE `activity_log` ADD COLUMN `ErrorContext` json DEFAULT NULL COMMENT "Detailed error info: {field, value, constraint, suggestion}"',
  'SELECT "ErrorContext column already exists"'
);

PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- ErrorSeverity
SET @col_exists = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'activity_log' AND COLUMN_NAME = 'ErrorSeverity'
);

SET @sql = IF(@col_exists = 0,
  'ALTER TABLE `activity_log` ADD COLUMN `ErrorSeverity` enum(\'INFO\',\'WARNING\',\'ERROR\',\'CRITICAL\') DEFAULT \'ERROR\' COMMENT "Error classification level"',
  'SELECT "ErrorSeverity column already exists"'
);

PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- StackTrace
SET @col_exists = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'activity_log' AND COLUMN_NAME = 'StackTrace'
);

SET @sql = IF(@col_exists = 0,
  'ALTER TABLE `activity_log` ADD COLUMN `StackTrace` text DEFAULT NULL COMMENT "Python/Node stack trace if available"',
  'SELECT "StackTrace column already exists"'
);

PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Add indices if they don't exist
SET @idx_exists = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'activity_log' AND INDEX_NAME = 'idx_error_code'
);

SET @sql = IF(@idx_exists = 0,
  'ALTER TABLE `activity_log` ADD INDEX idx_error_code (`ErrorCode`)',
  'SELECT "idx_error_code already exists"'
);

PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @idx_exists = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'activity_log' AND INDEX_NAME = 'idx_error_severity'
);

SET @sql = IF(@idx_exists = 0,
  'ALTER TABLE `activity_log` ADD INDEX idx_error_severity (`ErrorSeverity`)',
  'SELECT "idx_error_severity already exists"'
);

PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;


-- ============================================================================
-- SECTION 2: Create error context table for detailed error information
-- ============================================================================

CREATE TABLE IF NOT EXISTS `error_context` (
  `ErrorContextID` varchar(50) NOT NULL PRIMARY KEY COMMENT 'UUID for error tracking',

  `ErrorCode` varchar(50) NOT NULL COMMENT 'Matches activity_log.ErrorCode',
  `ErrorMessage` text NOT NULL COMMENT 'User-friendly error message',
  `TechnicalMessage` text COMMENT 'Technical details for debugging',
  `SuggestedFix` text COMMENT 'Recommended resolution action',

  `TableName` varchar(100) NOT NULL COMMENT 'Which table had the issue',
  `ColumnName` varchar(100) COMMENT 'Which column (if applicable)',
  `ConstraintName` varchar(100) COMMENT 'Which constraint was violated',

  `ProblematicValue` text COMMENT 'The actual value that caused error',
  `ValidValueExamples` text COMMENT 'JSON array of valid example values',
  `AllowedRange` varchar(200) COMMENT 'If numeric: min-max; if enum: allowed values',

  `OffendingRowID` varchar(255) COMMENT 'Row identifier (JSON for compound keys)',
  `OffendingRowContext` json COMMENT 'Full row data (sensitive fields masked)',

  `DetectedAt` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT 'When error was first logged',
  `FirstOccurrence` datetime DEFAULT CURRENT_TIMESTAMP COMMENT 'When this error first happened',
  `LastOccurrence` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT 'Most recent occurrence',
  `OccurrenceCount` int DEFAULT 1 COMMENT 'How many times this error occurred',

  `Severity` enum('INFO','WARNING','ERROR','CRITICAL') DEFAULT 'ERROR',
  `Status` enum('NEW','ACKNOWLEDGED','IN_PROGRESS','RESOLVED','DUPLICATE','WONTFIX') DEFAULT 'NEW',
  `AssignedTo` varchar(255) DEFAULT NULL COMMENT 'Admin email responsible for fix',
  `ResolutionNotes` text COMMENT 'How it was fixed',
  `ResolvedAt` datetime DEFAULT NULL,

  KEY idx_error_code (`ErrorCode`),
  KEY idx_table_column (`TableName`, `ColumnName`),
  KEY idx_constraint (`ConstraintName`),
  KEY idx_severity_status (`Severity`, `Status`),
  KEY idx_detected_at (`DetectedAt`),
  KEY idx_status (`Status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- ============================================================================
-- SECTION 3: Add CHECK constraints with better error messaging (idempotent)
-- ============================================================================

-- Helper macro: safely add constraint if it doesn't exist
-- MySQL 5.7 doesn't have IF NOT EXISTS for constraints, so we check manually

-- submissions.Status
SET @constraint_exists = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'submissions' AND CONSTRAINT_NAME = 'chk_submissions_status_valid'
);

SET @sql = IF(@constraint_exists = 0,
  'ALTER TABLE `submissions` ADD CONSTRAINT chk_submissions_status_valid CHECK (`Status` IN (\'pending\',\'approved\',\'cancelled\',\'expired\'))',
  'SELECT "chk_submissions_status_valid already exists"'
);

PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- members.Status
SET @constraint_exists = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'members' AND CONSTRAINT_NAME = 'chk_members_status_valid'
);

SET @sql = IF(@constraint_exists = 0,
  'ALTER TABLE `members` ADD CONSTRAINT chk_members_status_valid CHECK (`Status` IN (\'active\',\'expired\',\'inactive\',\'pending\'))',
  'SELECT "chk_members_status_valid already exists"'
);

PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- payments.Amount
SET @constraint_exists = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'payments' AND CONSTRAINT_NAME = 'chk_payments_amount_nonnegative'
);

SET @sql = IF(@constraint_exists = 0,
  'ALTER TABLE `payments` ADD CONSTRAINT chk_payments_amount_nonnegative CHECK (`Amount` >= 0)',
  'SELECT "chk_payments_amount_nonnegative already exists"'
);

PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- submissions.Amount
SET @constraint_exists = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'submissions' AND CONSTRAINT_NAME = 'chk_submissions_amount_nonnegative'
);

SET @sql = IF(@constraint_exists = 0,
  'ALTER TABLE `submissions` ADD CONSTRAINT chk_submissions_amount_nonnegative CHECK (`Amount` IS NULL OR `Amount` >= 0)',
  'SELECT "chk_submissions_amount_nonnegative already exists"'
);

PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- gmail_transactions.Amount
SET @constraint_exists = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'gmail_transactions' AND CONSTRAINT_NAME = 'chk_gmail_amount_nonnegative'
);

SET @sql = IF(@constraint_exists = 0,
  'ALTER TABLE `gmail_transactions` ADD CONSTRAINT chk_gmail_amount_nonnegative CHECK (`Amount` IS NULL OR `Amount` >= 0)',
  'SELECT "chk_gmail_amount_nonnegative already exists"'
);

PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- submissions.PaymentDate
SET @constraint_exists = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'submissions' AND CONSTRAINT_NAME = 'chk_submissions_payment_date_reasonable'
);

SET @sql = IF(@constraint_exists = 0,
  'ALTER TABLE `submissions` ADD CONSTRAINT chk_submissions_payment_date_reasonable CHECK (`PaymentDate` IS NULL OR (`PaymentDate` >= DATE_SUB(CURDATE(), INTERVAL 365 DAY) AND `PaymentDate` <= DATE_ADD(CURDATE(), INTERVAL 30 DAY)))',
  'SELECT "chk_submissions_payment_date_reasonable already exists"'
);

PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- members.Email
SET @constraint_exists = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'members' AND CONSTRAINT_NAME = 'chk_members_email_valid'
);

SET @sql = IF(@constraint_exists = 0,
  'ALTER TABLE `members` ADD CONSTRAINT chk_members_email_valid CHECK (`Email` IS NULL OR `Email` LIKE \'%@%\')',
  'SELECT "chk_members_email_valid already exists"'
);

PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- activity_log.Email
SET @constraint_exists = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'activity_log' AND CONSTRAINT_NAME = 'chk_actlog_email_valid'
);

SET @sql = IF(@constraint_exists = 0,
  'ALTER TABLE `activity_log` ADD CONSTRAINT chk_actlog_email_valid CHECK (`Email` IS NULL OR `Email` LIKE \'%@%\')',
  'SELECT "chk_actlog_email_valid already exists"'
);

PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;


-- ============================================================================
-- SECTION 4: Trigger for submissions validation with error messages
-- ============================================================================

DELIMITER $$

CREATE TRIGGER trg_submissions_insert_validate
BEFORE INSERT ON `submissions`
FOR EACH ROW
BEGIN
  DECLARE error_context_id VARCHAR(50);
  DECLARE error_msg TEXT;
  DECLARE error_code VARCHAR(50);

  SET error_context_id = UUID();

  IF NEW.`SubmissionID` IS NULL THEN
    SET error_code = 'SUBM_NULL_ID';
    SET error_msg = CONCAT(
      'Submission ID cannot be NULL. ',
      'Error: ', error_context_id
    );
    INSERT INTO `error_context` (
      `ErrorContextID`, `ErrorCode`, `ErrorMessage`, `TechnicalMessage`,
      `TableName`, `ColumnName`, `ProblematicValue`,
      `ValidValueExamples`, `SuggestedFix`, `Severity`
    ) VALUES (
      error_context_id, error_code,
      'Cannot create submission without unique ID',
      'SubmissionID column received NULL value on INSERT',
      'submissions', 'SubmissionID', 'NULL',
      '["sub_abc123xyz", "sub_2026_001"]',
      'Ensure UUID is generated before INSERT. Check application code.',
      'CRITICAL'
    );
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = error_msg;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM `members` WHERE `MemberID` = NEW.`MemberID`) THEN
    SET error_code = 'SUBM_FK_INVALID_MEMBER';
    SET error_msg = CONCAT(
      'MemberID "', NEW.`MemberID`, '" does not exist in members table. ',
      'Error: ', error_context_id
    );
    INSERT INTO `error_context` (
      `ErrorContextID`, `ErrorCode`, `ErrorMessage`, `TechnicalMessage`,
      `TableName`, `ColumnName`, `ConstraintName`, `ProblematicValue`,
      `SuggestedFix`, `Severity`
    ) VALUES (
      error_context_id, error_code,
      CONCAT('Invalid MemberID: ', NEW.`MemberID`),
      'Foreign key validation failed: referenced member does not exist',
      'submissions', 'MemberID', 'fk_submissions_members',
      NEW.`MemberID`,
      'Verify MemberID exists in members table before creating submission',
      'ERROR'
    );
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = error_msg;
  END IF;

  IF NEW.`Status` NOT IN ('pending','approved','cancelled','expired') THEN
    SET error_code = 'SUBM_INVALID_STATUS';
    SET error_msg = CONCAT(
      'Invalid Status value: "', NEW.`Status`, '". ',
      'Allowed: pending, approved, cancelled, expired. ',
      'Error: ', error_context_id
    );
    INSERT INTO `error_context` (
      `ErrorContextID`, `ErrorCode`, `ErrorMessage`, `TechnicalMessage`,
      `TableName`, `ColumnName`, `ProblematicValue`,
      `AllowedRange`, `ValidValueExamples`, `SuggestedFix`, `Severity`
    ) VALUES (
      error_context_id, error_code,
      CONCAT('Invalid submission status: ', NEW.`Status`),
      'Status enum constraint violated',
      'submissions', 'Status', NEW.`Status`,
      'pending | approved | cancelled | expired',
      '["pending", "approved"]',
      'Use one of the allowed status values. Default is "pending".',
      'ERROR'
    );
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = error_msg;
  END IF;

  IF NEW.`Amount` IS NOT NULL AND NEW.`Amount` < 0 THEN
    SET error_code = 'SUBM_NEGATIVE_AMOUNT';
    SET error_msg = CONCAT(
      'Amount cannot be negative: ', NEW.`Amount`, '. ',
      'Error: ', error_context_id
    );
    INSERT INTO `error_context` (
      `ErrorContextID`, `ErrorCode`, `ErrorMessage`, `TechnicalMessage`,
      `TableName`, `ColumnName`, `ProblematicValue`,
      `AllowedRange`, `SuggestedFix`, `Severity`
    ) VALUES (
      error_context_id, error_code,
      'Submission amount is negative',
      'Amount validation failed: received negative value',
      'submissions', 'Amount', CAST(NEW.`Amount` AS CHAR),
      '>= 0',
      'Ensure amount is positive. Use absolute value or check calculation logic.',
      'WARNING'
    );
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = error_msg;
  END IF;
END$$

DELIMITER ;


-- ============================================================================
-- SECTION 5: Trigger for members validation
-- ============================================================================

DELIMITER $$

CREATE TRIGGER trg_members_insert_validate
BEFORE INSERT ON `members`
FOR EACH ROW
BEGIN
  DECLARE error_context_id VARCHAR(50);
  DECLARE error_msg TEXT;

  SET error_context_id = UUID();

  IF NEW.`Email` IS NOT NULL AND NEW.`Email` NOT LIKE '%@%' THEN
    SET error_msg = CONCAT(
      'Invalid email format: "', NEW.`Email`, '". Must contain @. ',
      'Error: ', error_context_id
    );
    INSERT INTO `error_context` (
      `ErrorContextID`, `ErrorCode`, `ErrorMessage`, `TechnicalMessage`,
      `TableName`, `ColumnName`, `ProblematicValue`,
      `ValidValueExamples`, `SuggestedFix`, `Severity`
    ) VALUES (
      error_context_id, 'MEM_INVALID_EMAIL',
      CONCAT('Email format invalid: ', NEW.`Email`),
      'Email validation failed: missing @ symbol',
      'members', 'Email', NEW.`Email`,
      '["john@example.com", "jane.doe@company.org"]',
      'Verify email address format matches standard email pattern (user@domain.com)',
      'WARNING'
    );
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = error_msg;
  END IF;

  IF NEW.`Status` NOT IN ('active','expired','inactive','pending') THEN
    SET error_msg = CONCAT(
      'Invalid Status: "', NEW.`Status`, '". ',
      'Allowed: active, expired, inactive, pending. ',
      'Error: ', error_context_id
    );
    INSERT INTO `error_context` (
      `ErrorContextID`, `ErrorCode`, `ErrorMessage`, `TechnicalMessage`,
      `TableName`, `ColumnName`, `ProblematicValue`,
      `AllowedRange`, `SuggestedFix`, `Severity`
    ) VALUES (
      error_context_id, 'MEM_INVALID_STATUS',
      CONCAT('Invalid member status: ', NEW.`Status`),
      'Status enum constraint violated on members table',
      'members', 'Status', NEW.`Status`,
      'active | expired | inactive | pending',
      'Status must be one of: active (paying), expired (may renew), inactive (left), pending (awaiting payment)',
      'ERROR'
    );
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = error_msg;
  END IF;
END$$

DELIMITER ;


-- ============================================================================
-- SECTION 6: Trigger for payments validation
-- ============================================================================

DELIMITER $$

CREATE TRIGGER trg_payments_insert_validate
BEFORE INSERT ON `payments`
FOR EACH ROW
BEGIN
  DECLARE error_context_id VARCHAR(50);
  DECLARE error_msg TEXT;

  SET error_context_id = UUID();

  IF NEW.`Amount` IS NOT NULL AND NEW.`Amount` < 0 THEN
    SET error_msg = CONCAT(
      'Payment amount cannot be negative: ', NEW.`Amount`, '. ',
      'Error: ', error_context_id
    );
    INSERT INTO `error_context` (
      `ErrorContextID`, `ErrorCode`, `ErrorMessage`, `TechnicalMessage`,
      `TableName`, `ColumnName`, `ProblematicValue`,
      `AllowedRange`, `SuggestedFix`, `Severity`
    ) VALUES (
      error_context_id, 'PAY_NEGATIVE_AMOUNT',
      'Payment amount is negative',
      CONCAT('Amount validation failed: ', NEW.`Amount`),
      'payments', 'Amount', CAST(NEW.`Amount` AS CHAR),
      '>= 0',
      'Check payment amount calculation. Use absolute value if needed.',
      'WARNING'
    );
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = error_msg;
  END IF;

  IF NEW.`SubmissionID` IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM `submissions` WHERE `SubmissionID` = NEW.`SubmissionID`) THEN
      SET error_msg = CONCAT(
        'SubmissionID "', NEW.`SubmissionID`, '" does not exist. ',
        'Error: ', error_context_id
      );
      INSERT INTO `error_context` (
        `ErrorContextID`, `ErrorCode`, `ErrorMessage`, `TechnicalMessage`,
        `TableName`, `ColumnName`, `ConstraintName`, `ProblematicValue`,
        `SuggestedFix`, `Severity`
      ) VALUES (
        error_context_id, 'PAY_FK_INVALID_SUBMISSION',
        CONCAT('Referenced submission not found: ', NEW.`SubmissionID`),
        'Foreign key validation failed on payments.SubmissionID',
        'payments', 'SubmissionID', 'fk_payments_submissions',
        NEW.`SubmissionID`,
        'Verify SubmissionID exists before linking payment. Or leave NULL if payment is standalone.',
        'WARNING'
      );
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = error_msg;
    END IF;
  END IF;
END$$

DELIMITER ;


-- ============================================================================
-- SECTION 7: Stored procedure to generate error summary report
-- ============================================================================

DELIMITER $$

CREATE PROCEDURE sp_error_summary_report(IN days_back INT)
BEGIN
  -- Generate summary of recent errors grouped by type and severity
  SELECT
    `ErrorCode`,
    `TableName`,
    `ColumnName`,
    `Severity`,
    `Status`,
    COUNT(*) as occurrence_count,
    MIN(`FirstOccurrence`) as first_seen,
    MAX(`LastOccurrence`) as last_seen,
    GROUP_CONCAT(DISTINCT `OffendingRowID` SEPARATOR ', ') as sample_row_ids,
    MAX(`SuggestedFix`) as recommended_fix
  FROM `error_context`
  WHERE `DetectedAt` >= NOW() - INTERVAL days_back DAY
  GROUP BY `ErrorCode`, `Severity`, `Status`
  ORDER BY occurrence_count DESC, `Severity` DESC;
END$$

DELIMITER ;


-- ============================================================================
-- SECTION 8: Helper view for unresolved errors
-- ============================================================================

CREATE OR REPLACE VIEW v_unresolved_errors AS
SELECT
  `ErrorContextID`,
  `ErrorCode`,
  `ErrorMessage`,
  `TableName`,
  `ColumnName`,
  `Severity`,
  `OccurrenceCount`,
  `LastOccurrence`,
  `AssignedTo`,
  `SuggestedFix`,
  CASE
    WHEN `Severity` = 'CRITICAL' THEN 'URGENT'
    WHEN `Severity` = 'ERROR' AND `OccurrenceCount` > 5 THEN 'HIGH'
    WHEN `Severity` = 'ERROR' THEN 'MEDIUM'
    ELSE 'LOW'
  END as priority
FROM `error_context`
WHERE `Status` IN ('NEW', 'ACKNOWLEDGED', 'IN_PROGRESS')
ORDER BY
  FIELD(`Severity`, 'CRITICAL', 'ERROR', 'WARNING', 'INFO') DESC,
  `OccurrenceCount` DESC,
  `LastOccurrence` DESC;


-- ============================================================================
-- SECTION 9: Record migration in schema_migrations table
-- ============================================================================

INSERT INTO schema_migrations (version, description) VALUES
('007', 'Improve Error Messages & Validation: error_context table, 3 validation triggers, 9 CHECK constraints, v_unresolved_errors view, sp_error_summary_report procedure')
ON DUPLICATE KEY UPDATE executed_at = CURRENT_TIMESTAMP;


SET FOREIGN_KEY_CHECKS = 1;
